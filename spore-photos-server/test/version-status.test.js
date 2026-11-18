/**
 * The status payload: what the Version & Updates panel is allowed to know.
 *
 * Two things are worth asserting here rather than discovering on a live install:
 * the server's config-file path is sent only to an admin, and the upgrade path is
 * described for the shape this install actually is.
 *
 * `routes/version.js` pulls in `config`, which requires a database password, so
 * the test supplies a placeholder before requiring it — nothing here connects.
 */

process.env.PG_PASSWORD = process.env.PG_PASSWORD || 'test-password-not-used';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStatusPayload } = require('../routes/version');

const install = { method: 'docker', evidence: ['/.dockerenv'] };
const source = { url: 'https://example.test/release.json', origin: 'config', from: 'file', skipped: [] };
const check = { ok: true, updateAvailable: false, latest: '2.0.0', current: '2.0.0' };

test('an admin is told where the config file is', () => {
  const payload = buildStatusPayload({ current: '2.0.0', install, source, check, session: { role: 'admin' } });
  assert.ok(payload.configFile, 'names the file');
  assert.equal(typeof payload.configFileExists, 'boolean');
  assert.ok(payload.configExample, 'and the example to copy when it is missing');
});

test('a non-admin is not told where the config file is', () => {
  const payload = buildStatusPayload({ current: '2.0.0', install, source, check, session: { role: 'member' } });
  assert.equal(payload.configFile, undefined);
  assert.equal(payload.configFileExists, undefined);
  assert.equal(payload.configExample, undefined);
  // …but still gets everything the panel needs to be useful.
  assert.equal(payload.current, '2.0.0');
  assert.equal(payload.install.method, 'docker');
  assert.equal(payload.docs, 'docs/DOCKER.md');
  assert.equal(payload.sourceEnvVar, 'UPDATE_SOURCE_URL');
});

test('no session means no filesystem detail', () => {
  const payload = buildStatusPayload({ current: '2.0.0', install, source, check });
  assert.equal(payload.configFile, undefined);
});

test('an install shape with no update is still told how it would upgrade', () => {
  const payload = buildStatusPayload({ current: '2.0.0', install, source, check, session: { role: 'admin' } });
  assert.equal(payload.upgrade, undefined, 'nothing to upgrade to, so no update steps');
  assert.equal(payload.installPath.method, 'docker', 'but the path is always described');
  assert.ok(payload.installPath.steps.some((s) => s.includes('--build')));
});
