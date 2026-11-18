const test = require('node:test');
const assert = require('node:assert/strict');
const { getStatus, readCurrentVersion, parseBody } = require('../services/updateCheck');

const SOURCE = 'https://raw.githubusercontent.com/example-org/example-repo/refs/heads/main/release.json';

/** Minimal Response stand-in: enough for status/ok/headers/text. */
function res({ status = 200, body = '', headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null) },
    text: async () => body,
  };
}

/** A fetch that answers from a script and counts calls. */
function fakeFetch(handler) {
  const fn = async (url, opts) => {
    fn.calls.push({ url, opts });
    return handler(url, opts, fn.calls.length);
  };
  fn.calls = [];
  return fn;
}

const RELEASE = {
  version: '2.1.0',
  released: '2027-01-15',
  url: 'https://example.com/releases/tag/v2.1.0',
  notes: 'Fixes the album scroll bug.',
  upgrade: { breaking: false, minFrom: '2.0.0', migrations: true, backupFirst: true },
  android: { version: '2.1.0', rebuild: false },
};

/** In-memory cache store, so tests never touch the database. */
function memStore(initial = null) {
  const state = { value: initial, writes: 0 };
  return {
    state,
    async read() { return state.value; },
    async write(v) { state.value = v; state.writes += 1; },
  };
}

test('reports an update when upstream is newer', async () => {
  const fetchImpl = fakeFetch(() => res({ body: JSON.stringify(RELEASE) }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });

  assert.equal(out.ok, true);
  assert.equal(out.current, '2.0.0');
  assert.equal(out.latest, '2.1.0');
  assert.equal(out.updateAvailable, true);
  assert.equal(out.notes, 'Fixes the album scroll bug.');
  assert.deepEqual(out.upgrade, RELEASE.upgrade);
  assert.deepEqual(out.android, RELEASE.android);
  assert.equal(out.prerelease, false);
  assert.equal(out.fromCache, false);
  assert.ok(out.checkedAt, 'stamped with a timestamp for the panel');
});

test('silence when the version matches, and when the fork is ahead', async () => {
  for (const current of ['2.1.0', '2.2.0', '3.0.0']) {
    const fetchImpl = fakeFetch(() => res({ body: JSON.stringify(RELEASE) }));
    const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: current });
    assert.equal(out.ok, true, `${current}: check still succeeds`);
    assert.equal(out.updateAvailable, false, `${current} is not behind 2.1.0`);
    assert.equal(out.latest, '2.1.0');
  }
});

test('a version older than this install is never reported', async () => {
  const old = { ...RELEASE, version: '1.9.0' };
  const fetchImpl = fakeFetch(() => res({ body: JSON.stringify(old) }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.updateAvailable, false);
  assert.equal(out.latest, '1.9.0', 'reported factually, but not as an update');
});

test('a bare version string works — a VERSION file is a valid source', async () => {
  const fetchImpl = fakeFetch(() => res({ body: '2.1.0\n' }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.ok, true);
  assert.equal(out.latest, '2.1.0');
  assert.equal(out.updateAvailable, true);
  assert.equal(out.notes, null);
});

test('a prerelease is flagged, and not newer than its own release', async () => {
  const rc = { ...RELEASE, version: '2.2.0-rc.1' };
  const fetchImpl = fakeFetch(() => res({ body: JSON.stringify(rc) }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.1.0' });
  assert.equal(out.prerelease, true);
  assert.equal(out.updateAvailable, true, 'rc.1 of 2.2.0 is newer than 2.1.0');

  const fetchImpl2 = fakeFetch(() => res({ body: JSON.stringify(rc) }));
  const out2 = await getStatus({ source: SOURCE, fetchImpl: fetchImpl2, store: memStore(), currentVersion: '2.2.0' });
  assert.equal(out2.updateAvailable, false, 'a prerelease never outranks its own release');
});

test('unusable bodies are "unreadable", never "newest"', async () => {
  const bodies = ['', '   ', 'not json', '{', '{"version": ""}', '{"version": "latest"}', '{"version": "1.2"}', '<html>404</html>'];
  for (const body of bodies) {
    const fetchImpl = fakeFetch(() => res({ body }));
    const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });
    assert.equal(out.ok, false, `${JSON.stringify(body)} must not be ok`);
    assert.equal(out.reason, 'unreadable');
    assert.equal(out.updateAvailable, undefined, 'no verdict invented');
    assert.equal(out.current, '2.0.0', 'still reports what we run');
  }
});

test('parseBody accepts the real release.json shape and rejects versions that are not semver', () => {
  assert.equal(parseBody(JSON.stringify(RELEASE)).release.version, '2.1.0');
  assert.equal(parseBody('{"version":"v2.1.0"}').release.version, 'v2.1.0', 'a leading v is tolerated and compared correctly');
  assert.equal(parseBody('{"version":"latest"}').ok, false, 'but a word is not a version');
  assert.equal(parseBody('2.1.0').release.version, '2.1.0');
});

test('a 404 is a distinct, explainable reason', async () => {
  const fetchImpl = fakeFetch(() => res({ status: 404 }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not_published');
  assert.match(out.message, /404/);
});

test('a 500 is reported with its status', async () => {
  const fetchImpl = fakeFetch(() => res({ status: 503 }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'http_503');
});

test('a timeout and a network error are distinguishable, and neither throws', async () => {
  const timeout = fakeFetch(() => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    return Promise.reject(err);
  });
  assert.equal((await getStatus({ source: SOURCE, fetchImpl: timeout, store: memStore(), currentVersion: '2.0.0' })).reason, 'timeout');

  const boom = fakeFetch(() => { throw new Error('ENOTFOUND'); });
  const out = await getStatus({ source: SOURCE, fetchImpl: boom, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.reason, 'network');
  assert.equal(out.ok, false);
});

test('with no source configured, nothing is fetched and nothing is invented', async () => {
  // The important half of this test is the second assertion: an install with no
  // configured source must not be handed a default URL that belongs to someone
  // else's repository.
  const fetchImpl = fakeFetch(() => res({ body: JSON.stringify(RELEASE) }));
  const out = await getStatus({ source: '', fetchImpl, store: memStore(), currentVersion: '2.0.0' });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not_configured');
  assert.equal(out.source.url, '');
  assert.equal(out.current, '2.0.0', 'still reports what this install runs');
  assert.match(out.message, /config file|UPDATE_SOURCE_URL/);
  assert.equal(fetchImpl.calls.length, 0, 'no request is made without a configured source');
  assert.equal(out.updateAvailable, undefined, 'and certainly no verdict');
});

test('an invalid source is refused before any fetch happens', async () => {
  const fetchImpl = fakeFetch(() => res());
  const out = await getStatus({ source: 'file:///etc/passwd', fetchImpl, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid_source');
  assert.equal(fetchImpl.calls.length, 0, 'nothing was fetched');
});

test('an oversized body is refused', async () => {
  const fetchImpl = fakeFetch(() => res({ body: 'x'.repeat(300 * 1024) }));
  const out = await getStatus({ source: SOURCE, fetchImpl, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.reason, 'too_large');
});

test('the cache is used within its TTL and skipped when forced', async () => {
  const store = memStore();
  const fetchImpl = fakeFetch(() => res({ body: JSON.stringify(RELEASE) }));

  const first = await getStatus({ source: SOURCE, fetchImpl, store, currentVersion: '2.0.0', now: () => 1000 });
  assert.equal(first.fromCache, false);
  assert.equal(fetchImpl.calls.length, 1);

  const second = await getStatus({ source: SOURCE, fetchImpl, store, currentVersion: '2.0.0', now: () => 60_000 });
  assert.equal(second.fromCache, true);
  assert.equal(fetchImpl.calls.length, 1, 'one fetch per five minutes, not per render');

  // Forced inside the floor (29s later): still no fetch.
  const forced = await getStatus({ force: true, source: SOURCE, fetchImpl, store, currentVersion: '2.0.0', now: () => 30_000 });
  assert.equal(forced.throttled, true);
  assert.equal(fetchImpl.calls.length, 1);

  // Forced after the floor: fetches, and cache-busts the URL.
  const forcedLater = await getStatus({ force: true, source: SOURCE, fetchImpl, store, currentVersion: '2.0.0', now: () => 200_000 });
  assert.equal(forcedLater.fromCache, false);
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(String(fetchImpl.calls[1].url), /[?&]cb=/, 'a forced check must not read a CDN-cached copy');
});

test('a 304 reuses the cached result and keeps the etag', async () => {
  const store = memStore();
  const send = fakeFetch((url, opts, n) => (n === 1
    ? res({ body: JSON.stringify(RELEASE), headers: { etag: 'W/"v1"' } })
    : res({ status: 304 })));

  await getStatus({ source: SOURCE, fetchImpl: send, store, currentVersion: '2.0.0', now: () => 1000 });
  assert.equal(store.state.value.etag, 'W/"v1"');

  const out = await getStatus({ force: true, source: SOURCE, fetchImpl: send, store, currentVersion: '2.0.0', now: () => 200_000 });
  assert.equal(out.ok, true);
  assert.equal(out.latest, '2.1.0', 'the cached body is reused');
  assert.equal(send.calls[1].opts.headers['If-None-Match'], 'W/"v1"', 'conditional request sent');
});

test('a failed check reports the last good result instead of nothing', async () => {
  const store = memStore();
  const send = fakeFetch((url, opts, n) => (n === 1 ? res({ body: JSON.stringify(RELEASE) }) : res({ status: 502 })));

  await getStatus({ source: SOURCE, fetchImpl: send, store, currentVersion: '2.0.0', now: () => 1000 });
  const out = await getStatus({ force: true, source: SOURCE, fetchImpl: send, store, currentVersion: '2.0.0', now: () => 200_000 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'http_502');
  assert.equal(out.lastGood.latest, '2.1.0', 'the panel can still show what it last knew');
});

test('a token is dropped when a redirect leaves GitHub', async () => {
  const send = fakeFetch((url) => {
    if (String(url).includes('raw.githubusercontent.com')) {
      return res({ status: 302, headers: { location: 'https://evil.example.com/release.json' } });
    }
    return res({ body: JSON.stringify(RELEASE) });
  });

  const out = await getStatus({ source: SOURCE, fetchImpl: send, store: memStore(), currentVersion: '2.0.0', token: 'secret' });
  assert.equal(out.ok, true, 'the redirect was followed');
  assert.equal(send.calls.length, 2);
  assert.equal(send.calls[0].opts.headers.Authorization, 'Bearer secret', 'sent to GitHub');
  assert.ok(!('Authorization' in send.calls[1].opts.headers), 'and NOT to the host it redirected to');
});

test('redirects are capped', async () => {
  const send = fakeFetch((url) => res({ status: 302, headers: { location: `https://raw.githubusercontent.com/loop/${Math.random()}` } }));
  const out = await getStatus({ source: SOURCE, fetchImpl: send, store: memStore(), currentVersion: '2.0.0' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'too_many_redirects');
});

test('changing the source invalidates the cache — no stale answer from the old one', async () => {
  const store = memStore();
  const OTHER = 'https://gitlab.example.com/team/spore-photos/-/raw/main/release.json';
  const fetchImpl = fakeFetch((url) => (String(url).startsWith('https://gitlab.example.com')
    ? res({ body: JSON.stringify({ version: '1.0.0', notes: 'the other repo' }) })
    : res({ body: JSON.stringify(RELEASE) })));

  const first = await getStatus({ source: SOURCE, fetchImpl, store, currentVersion: '2.0.0', now: () => 1000 });
  assert.equal(first.latest, '2.1.0');

  // Repoint the source seconds later: the cached answer belongs to the old URL
  // and must not be reused, even though it is well inside the TTL and the
  // 60s force floor.
  const second = await getStatus({ force: true, source: OTHER, fetchImpl, store, currentVersion: '2.0.0', now: () => 5000 });
  assert.equal(fetchImpl.calls.length, 2, 'the new source was actually fetched');
  assert.equal(second.fromCache, false, 'a cache hit is impossible for a different URL');
  assert.equal(second.latest, '1.0.0', 'answer comes from the new source, not the old one');
  assert.equal(second.updateAvailable, false);

  // And the old URL's cache is not resurrected as "last good" for the new one.
  const failing = fakeFetch(() => res({ status: 500 }));
  const third = await getStatus({ force: true, source: OTHER, fetchImpl: failing, store, currentVersion: '2.0.0', now: () => 999_999 });
  assert.equal(third.reason, 'http_500');
  assert.equal(third.lastGood?.latest, '1.0.0', 'last good is the same source as the failed check');
});

test('readCurrentVersion reads release.json or VERSION, and never invents one', () => {
  const v = readCurrentVersion();
  assert.ok(v === null || require('../lib/semver').isVersion(v), `got ${JSON.stringify(v)}`);
});
