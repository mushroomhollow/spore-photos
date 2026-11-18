/**
 * Building an APK from the server's own UI.
 *
 * Everything here is a thin, careful wrapper around
 * `spore-photos-mobile/scripts/build-apk.sh`, and that is the point: the panel
 * and the command line must never disagree about whether a build is possible, so
 * readiness comes from the script's own `--check --json` rather than from a
 * second, drifting copy of the same probes in JavaScript.
 *
 * What this module will NOT do:
 *  - install a toolchain. Installing ~3 GB of JDK and Android SDK from a web
 *    panel is not something a settings screen should ever do; it reports what is
 *    missing and hands over the exact commands.
 *  - keep a passphrase. It is used for one command and dropped: never written to
 *    the log, never stored in the database, never passed on a command line where
 *    `ps` could read it.
 *  - run two builds at once, or leave a lock behind if the process dies.
 *
 * In a container built from the Dockerfile the mobile project is not present at
 * all, so `scriptAvailable()` is false and the panel explains the alternatives
 * instead of pretending to offer a button.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile, spawn } = require('child_process');

const semver = require('../lib/semver');
const apkDir = require('../lib/apkDir');
const { detect, buildSteps } = require('../lib/installMethod');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'spore-photos-mobile', 'scripts', 'build-apk.sh');
// Where the APKs this server can actually serve live. Not a constant: a native
// install keeps them in public/apk and a container image only has them in
// dist/apk, which is what the server serves from. See lib/apkDir.js.
const apkDirectory = () => apkDir.resolve();
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'apk-build.log');
const RESULT_PATH = path.join(DATA_DIR, 'apk-build-result.json');
const LOCK_PATH = path.join(DATA_DIR, 'apk-build.lock');

// `--check` only stats files and runs `java -version`; a lenient timeout keeps a
// slow disk from looking like a broken toolchain.
const PROBE_TIMEOUT_MS = 20000;

/**
 * The environment a build child gets.
 *
 * A service manager (systemd, Docker) usually hands the server a minimal PATH,
 * which is how a build that works in a shell fails with "npm not found" when it
 * is started from the UI. Node's own directory is the one place npm is certain
 * to be — the server is running on it — so it goes first, followed by the usual
 * locations. The passphrase is added by the caller and never logged.
 */
function childEnv(extra = {}) {
  const dirs = [
    path.dirname(process.execPath),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const existing = String(process.env.PATH || '').split(':').filter(Boolean);
  const merged = [...new Set([...dirs, ...existing])].join(':');

  return {
    ...process.env,
    PATH: merged,
    // Keep the build's own output clean and machine-readable where possible.
    CI: 'true',
    ...extra,
  };
}

function scriptAvailable() {
  try {
    return fs.existsSync(SCRIPT);
  } catch {
    return false;
  }
}

/**
 * The script's own readiness verdict. Returns null when it cannot be obtained —
 * callers must treat that as "unknown", never as "ready".
 */
function probe() {
  return new Promise((resolve) => {
    if (!scriptAvailable()) return resolve(null);
    execFile('bash', [SCRIPT, '--check', '--json'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      try {
        resolve({ ...JSON.parse(String(stdout)), exitCode: err?.code ?? 0 });
      } catch {
        resolve(null);
      }
    });
  });
}

/** The versioned APKs this server is actually serving, newest first. */
async function listAvailable() {
  const dir = apkDirectory();
  let files;
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const found = [];
  for (const filename of files) {
    const match = /^spore-photos-v(.+)\.apk$/.exec(filename);
    if (!match) continue;
    try {
      const stat = await fsp.stat(path.join(dir, filename));
      found.push({
        version: match[1],
        filename,
        size: stat.size,
        builtAt: stat.mtime.toISOString(),
        url: `/apk/${filename}`,
      });
    } catch {
      // A file that vanished between readdir and stat is not an error.
    }
  }

  return found.sort((a, b) => (semver.compare(b.version, a.version) || 0));
}

async function readResult() {
  try {
    return JSON.parse(await fsp.readFile(RESULT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function isBuilding() {
  try {
    return fs.existsSync(LOCK_PATH);
  } catch {
    return false;
  }
}

/** A stale lock (a killed process) must not block builds forever. */
async function clearStaleLock(maxAgeMs = 60 * 60 * 1000) {
  try {
    const stat = await fsp.stat(LOCK_PATH);
    if (Date.now() - stat.mtimeMs > maxAgeMs) await fsp.unlink(LOCK_PATH);
  } catch {
    // No lock, or it disappeared — either way there is nothing to do.
  }
}

/** The tail of the build log, for the panel's live view. */
async function logTail(maxBytes = 4000) {
  try {
    const content = await fsp.readFile(LOG_PATH, 'utf8');
    return content.length > maxBytes ? content.slice(-maxBytes) : content;
  } catch {
    return '';
  }
}

/**
 * Whether this server could write into <target> — without creating anything.
 *
 * The panel asks on a GET it makes every time it opens, so a probe that mkdirs is a
 * side effect on a read path, and it would leave a *root-owned* directory behind if
 * the server ever ran as root. That is the trap the build script's require_writable()
 * exists to report, so it is not one to introduce here.
 *
 * A path that does not exist yet is fine as long as its nearest existing ancestor is
 * writable, which is exactly what a build needs.
 */
async function writableDir(target) {
  let dir = target;
  for (;;) {
    try {
      await fsp.access(dir, fs.constants.W_OK);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') return false; // exists, and is not writable
      const parent = path.dirname(dir);
      if (parent === dir) return false; // walked up to the root
      dir = parent;
    }
  }
}

/**
 * The full picture for the Download App panel. Never throws: a settings screen
 * has to render even when the machine it is describing is in a strange state.
 */
async function status() {
  await clearStaleLock();

  const check = await probe();
  const available = await listAvailable();
  const result = await readResult();
  const method = detect().method;
  const dir = apkDirectory();
  const apkDirWritable = await writableDir(dir);

  return {
    // 'ready' | 'no_toolchain' | 'no_keystore' | 'build_on_host' | 'unavailable'
    //
    // A container has no build script because the app image deliberately carries
    // no 2 GB Android SDK — but building is still supported there, on the host,
    // so calling that 'unavailable' would be wrong and would hide the recipe.
    state: !scriptAvailable()
      ? (method === 'docker' ? 'build_on_host' : 'unavailable')
      : !check
        ? 'unavailable'
        : check.exitCode === 0
          ? 'ready'
          : check.exitCode === 3
            ? 'no_keystore'
            : 'no_toolchain',
    scriptAvailable: scriptAvailable(),
    method,
    // Said out loud so a misdetection is visible rather than quietly wrong — the
    // same reason installMethod.detect() reports its evidence.
    methodEvidence: detect().evidence,
    apkDir: apkDir.describe(dir),
    apkDirWritable,
    // The build recipe for this install shape, generated like the upgrade steps
    // so a container operator is not handed a command that cannot work here.
    // apkWritable is passed in because it decides whether a build on a container
    // install still needs an image rebuild before anyone can download it.
    buildPath: buildSteps(method, { version: check?.version ?? null, apkWritable: apkDirWritable }),
    version: check?.version ?? null,
    versionCode: check?.versionCode ?? null,
    apkName: check?.apkName ?? null,
    java: check?.java ?? null,
    sdk: check?.sdk ?? null,
    buildTools: check?.buildTools ?? null,
    apksigner: check?.apksigner ?? null,
    keystore: check?.keystore ?? { path: null, present: false, alias: null, sha256: null },
    outDir: check?.outDir ?? null,
    hints: check?.hints ?? null,
    available,
    building: isBuilding(),
    lastBuild: result,
    log: isBuilding() ? await logTail() : null,
  };
}

/**
 * Create the signing key. Refuses if one exists — replacing a key silently would
 * make every app already installed on the operator's phones un-updatable.
 */
function initKeystore(passphrase, { alias } = {}) {
  return new Promise((resolve) => {
    if (!scriptAvailable()) return resolve({ ok: false, error: 'build_script_missing' });

    const args = [SCRIPT, '--init-keystore'];
    if (alias) args.push('--alias', alias);

    execFile(
      'bash',
      args,
      // The passphrase travels in the environment, never in argv.
      { timeout: 60000, env: childEnv({ SPORE_KEYSTORE_PASS: passphrase }) },
      (err, stdout, stderr) => {
        const output = `${stdout || ''}${stderr || ''}`;
        if (err) {
          const alreadyExists = /already exists/i.test(output);
          return resolve({
            ok: false,
            error: alreadyExists ? 'keystore_exists' : 'keystore_failed',
            // Strip anything that could echo the passphrase back to a browser.
            detail: output.replace(new RegExp(passphrase, 'g'), '***').slice(-600),
          });
        }
        const fingerprint = /sha256\s+([0-9A-F:]+)/i.exec(output);
        resolve({ ok: true, fingerprint: fingerprint ? fingerprint[1] : null });
      },
    );
  });
}

/**
 * Start a build and return immediately; the panel watches the log. The child is
 * detached so it survives a request that gives up waiting.
 */
async function startBuild(passphrase, { version } = {}) {
  await clearStaleLock();

  if (!scriptAvailable()) return { ok: false, error: 'build_script_missing' };
  if (isBuilding()) return { ok: false, error: 'build_in_progress' };

  const check = await probe();
  if (!check) return { ok: false, error: 'toolchain_unknown' };
  if (check.exitCode === 2) return { ok: false, error: 'no_toolchain', hints: check.hints };
  if (check.exitCode === 3) return { ok: false, error: 'no_keystore' };

  // A build is always for the version this install *is*: building a different
  // number would ship code labelled as something it is not.
  if (version && version !== check.version) {
    return { ok: false, error: 'version_mismatch', expected: check.version };
  }

  if (!passphrase) return { ok: false, error: 'passphrase_required' };

  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(LOCK_PATH, `${new Date().toISOString()}\n`);
  await fsp.writeFile(LOG_PATH, `=== build requested ${new Date().toISOString()} ===\n`);
  try {
    await fsp.unlink(RESULT_PATH);
  } catch {
    // No previous result — fine.
  }

  const fd = fs.openSync(LOG_PATH, 'a');
  const child = spawn('bash', [SCRIPT, 'build', check.version], {
    cwd: path.join(REPO_ROOT, 'spore-photos-mobile'),
    detached: true,
    stdio: ['ignore', fd, fd],
    env: childEnv({
      SPORE_KEYSTORE_PASS: passphrase,
      SPORE_JSON_OUT: RESULT_PATH,
    }),
  });
  child.unref();
  fs.closeSync(fd);

  // The lock is released when the child exits. `detached` means we cannot wait
  // on it here, so a small watcher does: this also survives the HTTP request.
  const watcher = setInterval(async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      clearInterval(watcher);
      try {
        await fsp.unlink(LOCK_PATH);
      } catch { /* already gone */ }
    }
  }, 2000);
  watcher.unref?.();

  return { ok: true, version: check.version, apkName: check.apkName };
}

module.exports = {
  status,
  startBuild,
  initKeystore,
  probe,
  listAvailable,
  logTail,
  scriptAvailable,
  isBuilding,
  clearStaleLock,
  SCRIPT,
  apkDirectory,
  writableDir,
  LOG_PATH,
};
