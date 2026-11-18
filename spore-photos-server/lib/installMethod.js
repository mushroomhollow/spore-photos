const semver = require('./semver');

/**
 * How was this instance installed, and what does upgrading look like here?
 *
 * The panel is notify-only, so its entire job is to hand the operator the right
 * three commands rather than a generic "upgrade your software" cop-out. Two
 * supported shapes: a container (compose, the Proxmox-style deployment) and a
 * manual checkout on a plain host.
 *
 * Detection is evidence-based and reported: the panel shows what it saw, so a
 * misdetection is visible and correctable rather than quietly wrong.
 */

const fs = require('fs');

/** File/marker checks, injectable so this is testable off a container. */
const CONTAINER_MARKERS = ['/.dockerenv', '/run/.containerenv'];

function detect(options = {}) {
  const {
    env = process.env,
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
  } = options;

  // An explicit override always wins: an operator whose setup looks like
  // something else can say so once, in the environment.
  const override = String(env.SPORE_PHOTOS_INSTALL_METHOD || '').trim().toLowerCase();
  if (override === 'docker' || override === 'manual') {
    return { method: override, evidence: ['SPORE_PHOTOS_INSTALL_METHOD=' + override] };
  }

  const evidence = [];
  for (const marker of CONTAINER_MARKERS) {
    try {
      if (existsSync(marker)) evidence.push(marker);
    } catch { /* unreadable marker is not evidence */ }
  }

  if (!evidence.length) {
    try {
      const cgroup = String(readFileSync('/proc/1/cgroup', 'utf8'));
      if (/docker|containerd|kubepods|podman/.test(cgroup)) evidence.push('/proc/1/cgroup');
    } catch { /* not Linux, or no /proc */ }
  }

  return evidence.length
    ? { method: 'docker', evidence }
    : { method: 'manual', evidence: ['no container markers found'] };
}

const DOCS = {
  docker: 'docs/DOCKER.md',
  manual: 'docs/INSTALL.md',
};

/**
 * The upgrade recipe for this install shape.
 *
 * Steps are verbatim-copyable commands, because the audience is a person
 * ssh'd into a box (or an agent doing it for them) and "consult the docs" is
 * not an answer.
 */
function upgradeSteps(method, info = {}) {
  const {
    latest = null,
    current = null,
    upgrade = {},
    installDir = null,
  } = info;

  const target = latest ? `v${String(latest).replace(/^v/, '')}` : '<the release tag>';
  const cd = installDir ? `cd ${installDir}` : 'cd /path/to/spore-photos';
  const warnings = [];

  if (upgrade.breaking) {
    warnings.push('This release contains breaking changes — read the release notes before upgrading.');
  }
  // Compare, do not just print. A release that declares a hard minimum is only
  // useful if an install below it is told so — previously every install got the
  // same sentence, whatever it was running, which made the warning decoration.
  // semver.compare returns null for an unusable version, and this payload carries
  // the server's own VERSION, so the unknown case stays advisory rather than
  // asserting something untrue.
  if (upgrade.minFrom) {
    const floor = String(upgrade.minFrom).replace(/^v/, '');
    const behind = current ? semver.compare(current, floor) : null;
    if (behind === -1) {
      warnings.push(`This install is v${current}; upgrade to at least v${floor} before this release.`);
    } else if (behind === null) {
      warnings.push(`This release expects at least v${floor} — check your version before upgrading.`);
    }
  }
  if (upgrade.migrations) {
    warnings.push(upgrade.migration
      ? `This release applies one database migration — ${upgrade.migration} — the first time the server starts. Back up first.`
      : 'This release changes the database. One migration runs the first time the server starts. Back up first.');
  }
  if (upgrade.backupFirst) {
    warnings.push('Back up your database and your photo library before you start.');
  }

  if (method === 'docker') {
    // The app image is built from this checkout — compose.yaml has a `build:`
    // and no registry — so `up -d` on its own reuses the existing image and
    // silently leaves the install on its current version. `--build` is the step
    // that actually performs the upgrade; `pull` only refreshes postgres.
    return {
      method,
      docs: DOCS.docker,
      steps: [
        `${cd}   # the directory holding your compose file`,
        `git pull            # or replace this checkout with ${target}`,
        'cd docker',
        'docker compose up -d --build',
        'docker compose logs -f api   # watch the migrations run',
      ],
      warnings,
      note: 'The image is built here rather than pulled, so --build is required. Your library and database live in the mounted volumes, so the containers can be replaced freely. If you added a compose.override.yaml to mount the APK directory — the workaround for the APK not being served — delete it: compose.yaml mounts that directory itself now, and a leftover override re-adds the mount it was written against.',
    };
  }

  return {
    method,
    docs: DOCS.manual,
    steps: [
      cd,
      `git fetch --tags && git checkout ${target}`,
      'cd spore-photos-server && npm ci --omit=dev',
      'npm run db:status    # what this release still has to run',
      'npm run db:init      # applies it, once',
      'cd ../spore-photos-client && npm ci && npm run build',
      'cd ../spore-photos-public-share && npm ci --omit=dev',
      'sudo systemctl restart spore-photos   # or however you run the service',
    ],
    warnings,
    note: 'Migrations are applied by `npm run db:init`, not by restarting the service — run it before the restart, and `npm run db:status` first to see exactly what it will run. If the unit name differs on your box, restart whatever runs spore-photos-server/index.js.',
  };
}

/**
 * The APK build recipe for this install shape.
 *
 * Same reasoning as upgradeSteps: the operator is ssh'd into a box, and the
 * whole difficulty of building the app is knowing which sequence of commands
 * applies. The container path is five commands, not one, and the last of them is
 * the one that is easy to miss — the API serves the APK out of the image, so a
 * build that is not followed by an image rebuild produces a file that 404s.
 */
function buildSteps(method, info = {}) {
  const { version = null, apkWritable = false } = info;
  const v = version ? ` ${String(version).replace(/^v/, '')}` : '';

  if (method === 'docker') {
    const steps = [
      'docker compose --profile build build builder        # one time: JDK 21 + Android SDK, ~1.8 GB',
      'docker compose --profile build run --rm builder --check --json',
      'docker compose --profile build run --rm builder --init-keystore    # one time ever, needs your passphrase',
      `docker compose --profile build run --rm builder build${v}`,
    ];

    // Whether the app image has to be rebuilt to publish the APK is a fact about
    // *this* install, so it is read rather than assumed: the shipped compose file
    // mounts the APK directory into the API (making a build live immediately), and
    // an install whose container cannot write that directory is serving from its
    // own image instead. `apkWritable` is the server's own finding, not a guess.
    if (!apkWritable) {
      steps.push('docker compose up -d --build    # required here: this API serves /apk/… out of its own image');
    }

    return {
      method,
      docs: 'docs/BUILD-APK.md',
      where: 'on the host, in the directory holding your compose file',
      steps,
      note: apkWritable
        ? 'This install mounts the APK directory, so the APK is downloadable as soon as it is built; `docker compose up -d --build` is only needed for code changes. The builder writes into your checkout as PUID/PGID, so run the git steps as that same user or re-run chown after an update.'
        : 'This install serves /apk/… out of its app image, so a build is not downloadable until that image is rebuilt — without the last command the build succeeds and the download 404s (or, worse on an older server, returns the web page instead). The current compose.yaml mounts the APK directory instead, so upgrading removes the step. The builder writes into your checkout as PUID/PGID, so run the git steps as that same user or re-run chown after an update.',
    };
  }

  return {
    method,
    docs: 'docs/BUILD-APK.md',
    where: 'on this machine',
    steps: [
      'cd /path/to/spore-photos/spore-photos-mobile',
      './scripts/build-apk.sh --check',
      './scripts/build-apk.sh --init-keystore    # one time ever, needs your passphrase',
      `SPORE_KEYSTORE_PASS=… ./scripts/build-apk.sh build${v}`,
    ],
    note: 'Needs a JDK 17+ and the Android SDK (~3 GB, one time). The APK lands in spore-photos-client/public/apk and downloads as soon as it is built. Pass --force to replace an existing build of the same version. If you front the app with your own nginx, route /apk/ to that directory — or run a client build, which copies it into dist/apk.',
  };
}

module.exports = { detect, upgradeSteps, buildSteps, CONTAINER_MARKERS, DOCS };
