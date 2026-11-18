const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, compare, isNewer, isVersion } = require('../lib/semver');

test('orders numeric triples', () => {
  assert.equal(compare('1.9.0', '1.10.0'), -1, '1.9.0 < 1.10.0');
  assert.equal(compare('1.10.0', '1.9.0'), 1, '1.10.0 > 1.9.0');
  assert.equal(compare('1.9.9', '1.10.0'), -1, '1.9.9 < 1.10.0');
  assert.equal(compare('1.10.0', '1.10.1'), -1, 'patch moves the needle');
  assert.equal(compare('2.0.0', '1.10.0'), 1, 'major outranks a high minor');
  assert.equal(compare('1.9.0', '1.9.0'), 0, 'equal');
  assert.equal(compare('0.0.1', '0.0.2'), -1, 'small numbers work');
});

test('accepts and normalises a leading v', () => {
  assert.equal(compare('v2.0.0', '2.0.0'), 0);
  assert.equal(parse('v1.2.3').raw, 'v1.2.3');
  assert.equal(parse(' 1.2.3 ').raw, '1.2.3', 'tolerates surrounding whitespace');
});

test('prereleases sort below their release, and against each other', () => {
  assert.equal(compare('1.10.0-rc.1', '1.10.0'), -1, 'rc < release');
  assert.equal(compare('1.10.0-rc.1', '1.10.0-rc.2'), -1, 'rc.1 < rc.2');
  assert.equal(compare('1.10.0-rc.2', '1.10.0-rc.10'), -1, 'numeric ids compare numerically, not lexically');
  assert.equal(compare('1.10.0-alpha', '1.10.0-beta'), -1, 'alphanumeric ordering');
  assert.equal(compare('1.10.0-alpha.1', '1.10.0-alpha'), 1, 'more fields wins when otherwise equal');
  assert.equal(compare('1.10.0-rc.1', '1.9.0'), 1, 'a prerelease still outranks an older release');
});

test('build metadata is ignored', () => {
  assert.equal(compare('2.0.0+build.5', '2.0.0'), 0);
  assert.equal(compare('2.0.0+build.5', '2.0.0+build.9'), 0);
});

test('malformed input yields null, never a verdict', () => {
  for (const bad of ['', '   ', 'garbage', '1.2', '1.2.3.4', 'v', 'latest', '1.2.x', null, undefined, 42]) {
    assert.equal(parse(bad), null, `parse(${JSON.stringify(bad)}) is null`);
    assert.equal(compare(bad, '1.0.0'), null, `compare(${JSON.stringify(bad)}, '1.0.0') is null`);
    assert.equal(compare('1.0.0', bad), null, `refuses when the second side is bad`);
    assert.equal(isVersion(bad), false);
  }
  assert.equal(isVersion('2.0.0'), true);
});

test('isNewer only fires on a strict increase', () => {
  assert.equal(isNewer('2.0.0', '1.9.0'), true);
  assert.equal(isNewer('2.0.0', '2.0.0'), false, 'equal is not newer');
  assert.equal(isNewer('1.9.0', '2.0.0'), false, 'an older upstream never nags');
  assert.equal(isNewer('1.10.0-rc.1', '1.10.0'), false, 'a prerelease is not newer than its release');
  assert.equal(isNewer('garbage', '1.0.0'), false, 'unparseable never counts as an update');
});
