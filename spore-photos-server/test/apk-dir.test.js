const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const apkDir = require('../lib/apkDir');

const APK = 'spore-photos-v2.0.1.apk';

test('prefers the build output directory when it holds a build', () => {
  const out = apkDir.resolve({
    existsSync: (p) => p === apkDir.PUBLIC_APK_DIR || p === apkDir.SERVED_APK_DIR,
    readdirSync: () => [APK],
  });
  assert.equal(out, apkDir.PUBLIC_APK_DIR);
});

test('an empty build directory does not hide a baked-in APK', () => {
  // The case this guards: the image was built with public/apk copied into dist,
  // and the mount added later is present but empty. Reporting "no APK" while the
  // download works is the bug.
  const out = apkDir.resolve({
    existsSync: () => true,
    readdirSync: (p) => (p === apkDir.SERVED_APK_DIR ? [APK, 'index.html'] : ['.gitkeep']),
  });
  assert.equal(out, apkDir.SERVED_APK_DIR);
});

test('falls back to the served directory — a container image only ever has this one', () => {
  const out = apkDir.resolve({
    existsSync: (p) => p === apkDir.SERVED_APK_DIR,
    readdirSync: () => [APK],
  });
  assert.equal(out, apkDir.SERVED_APK_DIR);
});

test('with nothing built anywhere it names where a build would go', () => {
  assert.equal(apkDir.resolve({ existsSync: () => true, readdirSync: () => ['.gitkeep'] }), apkDir.PUBLIC_APK_DIR);
  assert.equal(apkDir.resolve({ existsSync: () => false, readdirSync: () => [] }), apkDir.PUBLIC_APK_DIR);
});

test('a non-APK file in the directory does not make it the one', () => {
  const out = apkDir.resolve({
    existsSync: () => true,
    readdirSync: (p) => (p === apkDir.PUBLIC_APK_DIR ? ['notes.txt', '.gitkeep'] : [APK]),
  });
  assert.equal(out, apkDir.SERVED_APK_DIR);
});

test('an unreadable path is not a reason to stop looking', () => {
  const out = apkDir.resolve({
    existsSync: () => { throw new Error('EACCES'); },
    readdirSync: () => { throw new Error('EACCES'); },
  });
  assert.equal(out, apkDir.PUBLIC_APK_DIR);
});

test('the served directory is inside the web root the server actually serves', () => {
  // index.js serves spore-photos-client/dist. An APK outside that tree cannot be
  // downloaded, which is precisely what a container install was reporting: the
  // listing looked in public/apk, a directory a built image does not have.
  const webRoot = path.join(apkDir.REPO_ROOT, 'spore-photos-client', 'dist');
  assert.ok(apkDir.SERVED_APK_DIR.startsWith(webRoot + path.sep));
});

test('describe() reports a repository-relative path, for display', () => {
  assert.equal(apkDir.describe(apkDir.PUBLIC_APK_DIR), 'spore-photos-client/public/apk');
  assert.equal(apkDir.describe(apkDir.SERVED_APK_DIR), 'spore-photos-client/dist/apk');
});
