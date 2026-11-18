/**
 * Update-source parsing and request building.
 *
 * The operator configures the URL of a `release.json`: the raw view of a file
 * on a code host (…/refs/heads/main/release.json, GitLab's /-/raw/, Gitea's
 * /raw/branch/…), or any web server that happens to serve one. Because a raw
 * file is a raw file, this works against whatever host the operator runs, which
 * is the whole point — and there is no built-in URL, because this code has no
 * business choosing a repository on the operator's behalf.
 *
 * Two things this module is responsible for:
 *   1. Accepting that URL verbatim (plus the `owner/repo` shorthand) and
 *      refusing anything that is not http(s) — `javascript:`, `file:`, `data:`
 *      and friends must never reach a fetch call.
 *   2. Making sure a GitHub token is only ever sent to GitHub. A token attached
 *      to an operator-supplied host would hand a credential to whoever owns
 *      that host.
 */

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const DEFAULT_BRANCH = 'main';

// Only these hosts may ever receive the Authorization header.
const GITHUB_HOSTS = new Set([
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
]);

// Guardrails applied to every fetch. Measured in the plan: a release.json is a
// few hundred bytes, so these are generous by orders of magnitude.
const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Expand the `owner/repo` shorthand into the GitHub raw URL for release.json.
 * Branch defaults to main; `owner/repo.git` is tolerated because that is what
 * people paste from a clone command.
 */
function expandSlug(slug) {
  const cleaned = slug.replace(/\.git$/i, '');
  if (!SLUG_RE.test(cleaned)) return null;
  return `${GITHUB_RAW_BASE}/${cleaned}/refs/heads/${DEFAULT_BRANCH}/release.json`;
}

/**
 * parseUpdateSource(input) -> { url, kind } | null
 *
 * kind is 'github' when the resulting host may receive a token, 'generic'
 * otherwise. null means "not usable" — the caller turns that into a message
 * quoting the accepted forms, so a typo is visible instead of silent.
 */
function parseUpdateSource(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  // Shorthand first: a bare owner/repo is not a URL.
  let url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const expanded = expandSlug(raw);
    if (!expanded) return null;
    url = new URL(expanded);
  } else {
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  return {
    url: url.toString(),
    kind: isGithubHost(url.hostname) ? 'github' : 'generic',
  };
}

function isGithubHost(hostname) {
  return GITHUB_HOSTS.has(String(hostname || '').toLowerCase());
}

/**
 * buildRequest(source, { etag, cacheBust, token, userAgent })
 *   -> { url, headers, timeoutMs, maxBytes, maxRedirects }
 *
 * cacheBust exists because raw file hosts sit behind a CDN with a few minutes
 * of caching: without a changing URL, a release published a minute ago looks
 * invisible to a "Check now" press and reads as a bug.
 */
function buildRequest(source, { etag, cacheBust, token, userAgent } = {}) {
  const url = new URL(source.url);

  if (cacheBust) {
    const stamp = cacheBust === true ? Date.now() : cacheBust;
    url.searchParams.set('cb', String(stamp));
  }

  const headers = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
    'User-Agent': userAgent || 'spore-photos-update-check',
  };
  if (etag) headers['If-None-Match'] = etag;

  // The security-relevant line: a token never leaves for a third-party host.
  if (token && isGithubHost(url.hostname)) {
    headers.Authorization = `Bearer ${token}`;
  }

  return { url: url.toString(), headers, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, maxRedirects: MAX_REDIRECTS };
}

/** The forms quoted back to the user when their input is rejected. */
const ACCEPTED_FORMS = [
  'any https URL that returns a release.json (your own web server, GitLab /-/raw/, Gitea /raw/branch/, …)',
  '<owner>/<repo>   (shorthand: the raw-file URL for that GitHub repository, branch main)',
];

module.exports = {
  parseUpdateSource,
  buildRequest,
  expandSlug,
  isGithubHost,
  ACCEPTED_FORMS,
  GITHUB_RAW_BASE,
  DEFAULT_BRANCH,
  TIMEOUT_MS,
  MAX_BYTES,
  MAX_REDIRECTS,
};
