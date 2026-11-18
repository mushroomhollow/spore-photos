const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUpdateSource } = require('../lib/resolveUpdateSource');

test('with nothing configured, the answer is unset and no URL is invented', () => {
  const out = resolveUpdateSource({});
  assert.equal(out.origin, 'unset');
  assert.equal(out.url, '', 'no repository is assumed');
  assert.equal(out.kind, null);
  assert.deepEqual(out.skipped, []);
});

test('a configured value is used, on whatever host it points at', () => {
  const out = resolveUpdateSource({ configured: 'https://gitlab.example.com/team/repo/-/raw/main/release.json' });
  assert.equal(out.origin, 'config');
  assert.match(out.url, /gitlab\.example\.com/);
  assert.equal(out.kind, 'generic');
});

test('a plain raw-file URL is used as-is', () => {
  const out = resolveUpdateSource({ configured: 'someone/fork' });
  assert.equal(out.origin, 'config');
  assert.equal(out.url, 'https://raw.githubusercontent.com/someone/fork/refs/heads/main/release.json');
});

test('an unusable value is reported and treated as unset', () => {
  // The operator has to edit a file to fix this, so it must be visible rather
  // than silently equivalent to "no source configured".
  const out = resolveUpdateSource({ configured: 'javascript:alert(1)' });
  assert.equal(out.url, '');
  assert.deepEqual(out.skipped, [{ origin: 'config', value: 'javascript:alert(1)' }]);
});

test('whitespace-only values are treated as absent', () => {
  const out = resolveUpdateSource({ configured: '\n\t' });
  assert.equal(out.origin, 'unset');
  assert.deepEqual(out.skipped, []);
});

test('an owner/repo in the config expands, and is reported as the config origin', () => {
  const out = resolveUpdateSource({ configured: 'example-org/example-repo' });
  assert.equal(out.origin, 'config');
  assert.equal(out.url, 'https://raw.githubusercontent.com/example-org/example-repo/refs/heads/main/release.json');
});

test('a settings value is not a candidate at all — the config file is the only door', () => {
  // Guards the decision, not just the behaviour: the release source is an
  // operator setting, so a stray `stored` field must not be honoured.
  const out = resolveUpdateSource({ stored: 'https://gitlab.example.com/team/repo/-/raw/main/release.json' });
  assert.equal(out.origin, 'unset');
  assert.equal(out.url, '');
});
