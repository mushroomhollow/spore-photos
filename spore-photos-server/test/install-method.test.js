const test = require('node:test');
const assert = require('node:assert/strict');
const { detect, upgradeSteps, buildSteps } = require('../lib/installMethod');

const none = () => false;

test('detects a container from its markers', () => {
  const out = detect({ env: {}, existsSync: (p) => p === '/.dockerenv' });
  assert.equal(out.method, 'docker');
  assert.deepEqual(out.evidence, ['/.dockerenv']);
});

test('falls back to /proc/1/cgroup when no marker file exists', () => {
  const out = detect({
    env: {},
    existsSync: none,
    readFileSync: () => '0::/docker/abc123\n',
  });
  assert.equal(out.method, 'docker');
  assert.deepEqual(out.evidence, ['/proc/1/cgroup']);
});

test('reports a plain host install as manual, with its evidence', () => {
  const out = detect({ env: {}, existsSync: none, readFileSync: () => '0::/init.scope\n' });
  assert.equal(out.method, 'manual');
  assert.ok(out.evidence.length, 'says what it looked for');
});

test('an unreadable /proc is not an error', () => {
  const out = detect({
    env: {},
    existsSync: none,
    readFileSync: () => { throw new Error('ENOENT'); },
  });
  assert.equal(out.method, 'manual');
});

test('the environment override always wins', () => {
  assert.equal(detect({ env: { SPORE_PHOTOS_INSTALL_METHOD: 'manual' }, existsSync: (p) => p === '/.dockerenv' }).method, 'manual');
  assert.equal(detect({ env: { SPORE_PHOTOS_INSTALL_METHOD: 'DOCKER' }, existsSync: none }).method, 'docker');
  assert.match(detect({ env: { SPORE_PHOTOS_INSTALL_METHOD: 'docker' }, existsSync: none }).evidence[0], /SPORE_PHOTOS_INSTALL_METHOD/);
});

test('docker upgrade steps rebuild the locally built image', () => {
  const out = upgradeSteps('docker', { latest: '2.1.0', current: '2.0.0' });
  assert.equal(out.method, 'docker');
  assert.ok(out.steps.some((s) => s.includes('docker compose up -d --build')),
    'must rebuild: the image is built from the checkout, not pulled');
  assert.ok(!out.steps.some((s) => s.includes('docker compose pull')),
    'a pull delivers only postgres, so it would look like an upgrade and change nothing');
  assert.ok(out.steps.some((s) => s.includes('docker compose logs -f api')),
    'names a real service — the compose project is spore-photos, the services are db/api/share');
  assert.ok(out.steps.some((s) => s.includes('v2.1.0')), 'names the target version');
  assert.equal(out.docs, 'docs/DOCKER.md');
});

test('a migration is named, not warned about in the abstract', () => {
  const named = upgradeSteps('docker', {
    latest: '2.1.0',
    current: '2.0.0',
    upgrade: { migrations: true, migration: '2.1.0-photo-indexes.sql' },
  });
  assert.ok(named.warnings.some((w) => w.includes('2.1.0-photo-indexes.sql')),
    'the operator is told which file will run');

  const unnamed = upgradeSteps('docker', { latest: '2.1.0', current: '2.0.0', upgrade: { migrations: true } });
  assert.ok(unnamed.warnings.some((w) => /migration/i.test(w)), 'still warns without the filename');
});

test('minFrom is compared against the running version, not just printed', () => {
  const behind = upgradeSteps('docker', { latest: '3.0.0', current: '1.9.0', upgrade: { minFrom: '2.0.0' } });
  assert.ok(behind.warnings.some((w) => w.includes('v1.9.0') && w.includes('v2.0.0')),
    'names both versions when this install is below the floor');

  const atFloor = upgradeSteps('docker', { latest: '3.0.0', current: '2.0.0', upgrade: { minFrom: '2.0.0' } });
  assert.equal(atFloor.warnings.length, 0, 'silent at exactly the floor');

  const ahead = upgradeSteps('docker', { latest: '3.0.0', current: '2.5.0', upgrade: { minFrom: '2.0.0' } });
  assert.equal(ahead.warnings.length, 0, 'silent when ahead of it');

  const unknown = upgradeSteps('docker', { latest: '3.0.0', upgrade: { minFrom: '2.0.0' } });
  assert.ok(unknown.warnings.some((w) => w.includes('expects at least')),
    'advisory, not a claim, when the running version is unknown');
});

test('the upgrade path is describable with nothing to upgrade to', () => {
  // Used by the panel before an update exists: `latest` is null, so no version
  // is named and the steps stay general.
  const path = upgradeSteps('manual', { current: '2.0.0', upgrade: {} });
  assert.equal(path.method, 'manual');
  assert.ok(path.steps.length >= 5);
  assert.ok(path.steps.some((s) => s.includes('db:status')), 'shows what a release would run');
  assert.ok(path.steps.some((s) => s.includes('db:init')), 'and how to apply it');
});

test('manual upgrade steps checkout the tag and rebuild', () => {
  const out = upgradeSteps('manual', { latest: '2.1.0', installDir: '/srv/spore-photos' });
  assert.ok(out.steps[0].startsWith('cd /srv/spore-photos'));
  assert.ok(out.steps.some((s) => s.includes('git fetch --tags && git checkout v2.1.0')));
  assert.ok(out.steps.some((s) => s.includes('npm run build')), 'the client bundle is rebuilt');
  assert.equal(out.docs, 'docs/INSTALL.md');
});

test('both shapes fall back to a placeholder path rather than guessing one', () => {
  for (const method of ['docker', 'manual']) {
    const out = upgradeSteps(method, { latest: '2.1.0' });
    assert.ok(out.steps[0].includes('/path/to/spore-photos'), `${method}: no invented path`);
  }
});

test('upgrade warnings come from the release metadata', () => {
  const out = upgradeSteps('manual', {
    latest: '2.1.0',
    current: '1.9.0',
    upgrade: { breaking: true, minFrom: '2.0.0', migrations: true, backupFirst: true },
  });
  assert.equal(out.warnings.length, 4);
  assert.ok(out.warnings.some((w) => /breaking/i.test(w)));
  assert.ok(out.warnings.some((w) => w.includes('v2.0.0')), 'quotes minFrom without a double v');
});

test('no metadata means no scary warnings', () => {
  const out = upgradeSteps('docker', { latest: '2.1.0', current: '2.0.0', upgrade: {} });
  assert.deepEqual(out.warnings, []);
});

test('a container install that serves from its image is told to rebuild it', () => {
  const out = buildSteps('docker', { version: '2.0.1', apkWritable: false });
  assert.match(out.steps[out.steps.length - 1], /docker compose up -d --build/);
  assert.match(out.note, /not downloadable until that image is rebuilt/i);
});

test('a container install that mounts the APK directory is not told to rebuild', () => {
  // The shipped compose file mounts it, so the build is live at once; requiring a
  // rebuild there would send an operator to do work that changes nothing.
  const out = buildSteps('docker', { version: '2.0.1', apkWritable: true });
  assert.ok(!/up -d --build/.test(out.steps.join('\n')), 'no pointless rebuild step');
  assert.match(out.note, /as soon as it is built/i);
  assert.match(out.note, /PUID/, 'still names the ownership requirement');
});

test('the container build recipe ends with the step that publishes the APK', () => {
  // The finding this encodes: the old container advice was one command, and it
  // produced an APK the running API could not serve. The recipe has to end with
  // the image rebuild or it is not a recipe.
  const out = buildSteps('docker', { version: '2.0.1' });
  assert.equal(out.docs, 'docs/BUILD-APK.md');
  assert.match(out.steps.join('\n'), /builder build 2\.0\.1/);
  assert.match(out.steps[out.steps.length - 1], /docker compose up -d --build/);
  assert.match(out.note, /404/);
});

test('the manual build recipe is the script, and never the container step', () => {
  const out = buildSteps('manual', { version: '2.0.1' });
  assert.match(out.steps[0], /spore-photos-mobile/);
  assert.match(out.steps.join('\n'), /build-apk\.sh build 2\.0\.1/);
  assert.ok(!/up -d --build/.test(out.steps.join('\n')), 'no container-only step on a plain host');
});

test('a version is interpolated without doubling the v', () => {
  assert.match(buildSteps('docker', { version: 'v2.0.1' }).steps.join('\n'), /builder build 2\.0\.1/);
});

test('an unknown version still yields a runnable recipe', () => {
  const out = buildSteps('manual', {});
  assert.match(out.steps.join('\n'), /build-apk\.sh build$/m);
});
