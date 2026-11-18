const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseUpdateSource,
  buildRequest,
  isGithubHost,
  TIMEOUT_MS,
  MAX_BYTES,
  MAX_REDIRECTS,
} = require('../lib/updateSource');

const RAW_GITHUB =
  'https://raw.githubusercontent.com/example-org/example-repo/refs/heads/main/release.json';

test('accepts an operator-supplied URL verbatim', () => {
  const r = parseUpdateSource(RAW_GITHUB);
  assert.equal(r.url, RAW_GITHUB);
  assert.equal(r.kind, 'github');
});

test('accepts any http(s) host — this is the feature, not a hole', () => {
  const cases = [
    ['https://gitlab.example.com/team/spore-photos/-/raw/main/release.json', 'generic'],
    ['https://codeberg.org/forgejo/forgejo/raw/branch/main/release.json', 'generic'],
    ['http://192.168.1.50:3000/release.json', 'generic'], // a LAN forge over plain http
    ['http://localhost:8080/release.json', 'generic'],
  ];
  for (const [input, kind] of cases) {
    const r = parseUpdateSource(input);
    assert.ok(r, `${input} should be accepted`);
    assert.equal(r.kind, kind, `${input} kind`);
  }
});

test('expands the owner/repo shorthand, including a .git suffix', () => {
  const expected =
    'https://raw.githubusercontent.com/example-org/example-repo/refs/heads/main/release.json';
  assert.equal(parseUpdateSource('example-org/example-repo').url, expected);
  assert.equal(parseUpdateSource('example-org/example-repo.git').url, expected);
  assert.equal(parseUpdateSource('  example-org/example-repo  ').url, expected);
});

test('rejects anything that is not an http(s) source', () => {
  const bad = [
    '',
    '   ',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/plain,hello',
    'ftp://example.com/release.json',
    'not a url',
    '/just/a/path',
    'owner-only',
    'owner/repo/extra',
    null,
    undefined,
    42,
  ];
  for (const input of bad) {
    assert.equal(parseUpdateSource(input), null, `rejects ${JSON.stringify(input)}`);
  }
});

test('buildRequest applies the guardrails', () => {
  const req = buildRequest(parseUpdateSource(RAW_GITHUB));
  assert.equal(req.url, RAW_GITHUB);
  assert.equal(req.timeoutMs, TIMEOUT_MS);
  assert.equal(req.maxBytes, MAX_BYTES);
  assert.equal(req.maxRedirects, MAX_REDIRECTS);
  assert.match(req.headers['User-Agent'], /spore-photos/);
  assert.ok(!('Authorization' in req.headers), 'no token unless one is supplied');
  assert.ok(!('If-None-Match' in req.headers), 'no etag unless one is supplied');
});

test('cache-busting only appends cb when asked', () => {
  const source = parseUpdateSource(RAW_GITHUB);
  assert.ok(!buildRequest(source).url.includes('cb='), 'clean by default');
  assert.match(buildRequest(source, { cacheBust: true }).url, /[?&]cb=\d+/);
  assert.match(buildRequest(source, { cacheBust: 12345 }).url, /[?&]cb=12345/);
});

test('etag is forwarded when present', () => {
  const req = buildRequest(parseUpdateSource(RAW_GITHUB), { etag: 'W/"abc"' });
  assert.equal(req.headers['If-None-Match'], 'W/"abc"');
});

test('a token is never sent to a non-GitHub host', () => {
  const thirdParty = parseUpdateSource('https://gitlab.example.com/team/repo/-/raw/main/release.json');
  const req = buildRequest(thirdParty, { token: 'secret-token' });
  assert.ok(!('Authorization' in req.headers), 'token must not follow the URL off GitHub');

  const lan = parseUpdateSource('http://192.168.1.50:3000/release.json');
  assert.ok(!('Authorization' in buildRequest(lan, { token: 'secret-token' }).headers));
});

test('a token is sent to GitHub hosts when supplied', () => {
  const req = buildRequest(parseUpdateSource(RAW_GITHUB), { token: 'secret-token' });
  assert.equal(req.headers.Authorization, 'Bearer secret-token');
  assert.equal(isGithubHost('raw.githubusercontent.com'), true);
  assert.equal(isGithubHost('RAW.GITHUBUSERCONTENT.COM'), true);
  assert.equal(isGithubHost('github.example.com'), false);
  assert.equal(isGithubHost('notgithub.com'), false);
});

test('a redirect cannot smuggle the token off-host', () => {
  // buildRequest decides from the *source* host only; the fetch layer re-checks
  // after every hop. This asserts the intent at this layer.
  const source = parseUpdateSource('https://gitlab.example.com/x/release.json');
  assert.equal(source.kind, 'generic');
  assert.ok(!('Authorization' in buildRequest(source, { token: 't' }).headers));
});
