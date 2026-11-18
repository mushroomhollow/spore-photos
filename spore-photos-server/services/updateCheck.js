/**
 * Update checking.
 *
 * Flow: the operator configures a URL that returns a `release.json`; we fetch
 * it (on demand — see the caching rules below), read its `version`, and compare
 * it with the version this install is running. Anything newer is reported; an
 * equal or older version is silence, which is what makes the check safe for a
 * fork running ahead of upstream.
 *
 * Properties this module guarantees, because these are the ones that bite:
 *
 *  - **It never throws.** Every failure returns `{ ok: false, reason }` so the
 *    panel can say "couldn't check" instead of breaking the settings screen.
 *  - **It never guesses a version.** A body that is neither a release.json nor a
 *    bare version string is `unreadable`, not "0.0.0" and not "newest".
 *  - **A token never follows a redirect off GitHub.** Redirects are followed
 *    manually so every hop can be re-checked (see fetchWithRedirects).
 *
 * Caching is short-lived and on demand: the check runs when a user opens
 * Settings → Server, so nothing polls at boot or on a timer, and nothing phones
 * anywhere unless somebody is looking at that panel.
 */

const fs = require('fs');
const path = require('path');

const semver = require('../lib/semver');
const { parseUpdateSource, buildRequest, isGithubHost } = require('../lib/updateSource');

// No default source. This directory does not decide where an install looks for
// releases — the operator does, in Settings → Server or in their config file.
// Guessing a URL here would mean every install quietly phones a repository its
// owner never chose.
const NO_SOURCE_MESSAGE =
  'No release source is configured. Set update.sourceUrl in the server config file (or UPDATE_SOURCE_URL in the environment).';

// 5 minutes: one fetch per panel visit, not one per render.
const CACHE_TTL_MS = 5 * 60 * 1000;
// A forced check cannot be machine-gunned by a button.
const FORCE_FLOOR_MS = 60 * 1000;

const CACHE_KEY = 'update_cache';
const REPO_ROOT = path.join(__dirname, '..', '..');
const RELEASE_JSON_PATH = path.join(REPO_ROOT, 'release.json');

/**
 * What this install is running. `release.json` is authoritative (it ships with
 * the code), with VERSION as the fallback for an older checkout that predates
 * the file. Returns null if neither is readable — callers must not invent one.
 */
function readCurrentVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RELEASE_JSON_PATH, 'utf8'));
    if (parsed && typeof parsed.version === 'string') return parsed.version.trim();
  } catch {
    // fall through to VERSION
  }
  try {
    return fs.readFileSync(path.join(REPO_ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * A redirect can change the host, and with it the trust boundary. Today the
 * only host that ever receives a token is GitHub, so each hop drops the header
 * the moment it leaves. Returns the final Response, or { tooManyRedirects: true }.
 */
async function fetchWithRedirects(url, headers, options) {
  const { fetchImpl, maxRedirects, timeoutMs, token } = options;
  let current = url;
  let currentHeaders = headers;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await fetchImpl(current, {
      headers: currentHeaders,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
    const location = isRedirect ? res.headers.get('location') : null;
    if (!isRedirect || !location) return res;

    const next = new URL(location, current);
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return res;

    currentHeaders = { ...currentHeaders };
    if (token && !isGithubHost(next.hostname)) delete currentHeaders.Authorization;
    current = next.toString();
  }
  return { tooManyRedirects: true };
}

/**
 * Turn a response body into a normalised release record, or a reason it cannot
 * be one. Accepts our own release.json shape, and degrades to a bare version
 * string so a repo that only publishes a VERSION file still works.
 */
function parseBody(body) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, reason: 'unreadable' };

  if (text.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
    if (!version) return { ok: false, reason: 'unreadable' };
    if (!semver.isVersion(version)) return { ok: false, reason: 'unreadable', detail: `version "${version}" is not semver` };
    return {
      ok: true,
      release: {
        version,
        notes: typeof parsed.notes === 'string' ? parsed.notes : null,
        url: typeof parsed.url === 'string' ? parsed.url : null,
        released: typeof parsed.released === 'string' ? parsed.released : null,
        upgrade: parsed.upgrade && typeof parsed.upgrade === 'object' ? parsed.upgrade : null,
        android: parsed.android && typeof parsed.android === 'object' ? parsed.android : null,
      },
    };
  }

  // Not JSON: treat the body as a bare version string.
  if (semver.isVersion(text)) {
    return { ok: true, release: { version: text, notes: null, url: null, released: null, upgrade: null, android: null } };
  }
  return { ok: false, reason: 'unreadable', detail: 'body is neither release.json nor a version string' };
}

/** Default cache store: app_settings, via the soft-failing settings service. */
function defaultStore() {
  // Required lazily so unit tests never touch the database.
  const settings = require('./settings');
  return {
    async read() {
      try {
        const raw = await settings.getSetting(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async write(value) {
      try {
        await settings.setSetting(CACHE_KEY, JSON.stringify(value));
      } catch {
        // A cache that cannot persist is a performance problem, not a failure.
      }
    },
  };
}

/**
 * getStatus({ force, source, fetchImpl, store, now, currentVersion, token })
 *
 * source         the URL to check; empty means this install has none configured
 * fetchImpl      injected in tests; defaults to global fetch
 * store          { read, write } cache backend
 * now            injected clock
 * currentVersion overrides what this install is running (tests)
 */
async function getStatus(options = {}) {
  const {
    force = false,
    source: sourceInput = '',
    fetchImpl = globalThis.fetch,
    store = defaultStore(),
    now = Date.now,
    currentVersion = readCurrentVersion(),
    token = null,
  } = options;

  // Nothing configured is a normal state, not a failure to be worked around:
  // report it and stop. Nothing is fetched, and no URL is invented.
  if (!sourceInput) {
    return {
      ok: false,
      reason: 'not_configured',
      message: NO_SOURCE_MESSAGE,
      current: semver.isVersion(currentVersion) ? currentVersion : null,
      source: { url: '' },
    };
  }

  const source = parseUpdateSource(sourceInput);
  if (!source) {
    return { ok: false, reason: 'invalid_source', source: { url: String(sourceInput) }, current: currentVersion };
  }

  const current = semver.isVersion(currentVersion) ? currentVersion : null;
  const cached = await store.read();

  // The cache belongs to one URL. Without this key, an admin who repoints the
  // source and checks immediately is shown the *previous* source's answer —
  // "update available" from a repository they just stopped using.
  const cacheMatches = Boolean(cached) && cached.sourceUrl === source.url;
  const cacheAge = cacheMatches && cached.fetchedAt ? now() - cached.fetchedAt : Infinity;

  // Serve a fresh-enough cache without touching the network.
  if (cacheMatches && cacheAge < CACHE_TTL_MS && !force) {
    return { ...cached.result, fromCache: true, cacheAgeMs: cacheAge };
  }
  // A forced check still honours the floor, so the button cannot hammer a host.
  if (cacheMatches && force && cacheAge < FORCE_FLOOR_MS) {
    return { ...cached.result, fromCache: true, throttled: true, cacheAgeMs: cacheAge };
  }

  const lastGood = cacheMatches ? cached.result : null;

  let res;
  try {
    const req = buildRequest(source, { etag: cacheMatches ? cached.etag : undefined, cacheBust: force, token });
    res = await fetchWithRedirects(req.url, req.headers, {
      fetchImpl,
      maxRedirects: req.maxRedirects,
      timeoutMs: req.timeoutMs,
      token,
    });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, reason, message: err?.message, current, source, lastGood, };
  }

  if (res?.tooManyRedirects) {
    return { ok: false, reason: 'too_many_redirects', current, source, lastGood, };
  }

  if (res.status === 304 && cacheMatches) {
    const result = { ...cached.result, checkedAt: new Date(now()).toISOString() };
    await store.write({ sourceUrl: source.url, fetchedAt: now(), etag: cached.etag, result });
    return { ...result, fromCache: true };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: res.status === 404 ? 'not_published' : `http_${res.status}`,
      message: res.status === 404
        ? 'That URL returned 404 — the release.json may not be published there yet.'
        : `The update source returned HTTP ${res.status}.`,
      current,
      source,
      lastGood,
    };
  }

  let body;
  try {
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > 256 * 1024) {
      return { ok: false, reason: 'too_large', current, source, lastGood, };
    }
    body = await res.text();
  } catch (err) {
    return { ok: false, reason: 'read_failed', message: err?.message, current, source, lastGood, };
  }
  if (body.length > 256 * 1024) {
    return { ok: false, reason: 'too_large', current, source, lastGood, };
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, message: parsed.detail, current, source, lastGood, };
  }

  const { release } = parsed;
  const updateAvailable = Boolean(release.version) && semver.isNewer(release.version, current);
  const result = {
    ok: true,
    current,
    latest: release.version,
    updateAvailable,
    // A prerelease is reported, but never dressed up as a normal release.
    prerelease: /-/.test(release.version),
    notes: release.notes,
    url: release.url,
    released: release.released,
    upgrade: release.upgrade,
    android: release.android,
    source,
    checkedAt: new Date(now()).toISOString(),
    fromCache: false,
  };

  await store.write({ sourceUrl: source.url, fetchedAt: now(), etag: res.headers.get('etag') || null, result });
  return result;
}

module.exports = {
  getStatus,
  readCurrentVersion,
  parseBody,
  fetchWithRedirects,
  NO_SOURCE_MESSAGE,
  CACHE_TTL_MS,
  FORCE_FLOOR_MS,
};