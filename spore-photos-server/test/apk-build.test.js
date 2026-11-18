const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { writableDir } = require('../services/apkBuild');

const scratch = () => fsp.mkdtemp(path.join(os.tmpdir(), 'spore-apk-'));

test('an existing writable directory is writable', async () => {
  const dir = await scratch();
  assert.equal(await writableDir(dir), true);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('a path that does not exist yet is judged by its nearest existing ancestor', async () => {
  const dir = await scratch();
  const deep = path.join(dir, 'does', 'not', 'exist');
  assert.equal(await writableDir(deep), true, 'a build could create this');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('the probe creates nothing — it runs on a GET the panel makes', async () => {
  const dir = await scratch();
  const target = path.join(dir, 'spore-photos-client', 'public', 'apk');
  await writableDir(target);
  assert.equal(fs.existsSync(target), false, 'a read path must not leave a directory behind');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('a read-only ancestor is not writable', async () => {
  const dir = await scratch();
  await fsp.chmod(dir, 0o500);
  const result = await writableDir(path.join(dir, 'nope'));
  await fsp.chmod(dir, 0o700);
  await fsp.rm(dir, { recursive: true, force: true });
  if (process.getuid && process.getuid() === 0) return; // root ignores the mode
  assert.equal(result, false);
});
