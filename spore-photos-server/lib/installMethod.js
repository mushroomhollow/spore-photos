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
      note: 'The image is built here rather than pulled, so --build is required. Your library and database live in the mounted volumes, so the containers can be replaced freely.',
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

module.exports = { detect, upgradeSteps, CONTAINER_MARKERS, DOCS };
