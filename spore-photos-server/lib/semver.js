/**
 * Minimal SemVer comparison. No dependency: the whole thing is ~60 lines and
 * a supply-chain dependency for version maths would be a poor trade.
 *
 * parse() returns null for anything that is not a version — deliberately.
 * A malformed value in release.json must never be treated as "newest", or a
 * typo upstream would nag every install forever.
 */

// Optional leading v, then MAJOR.MINOR.PATCH, optional -prerelease, optional +build.
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  if (typeof version !== 'string') return null;
  const raw = version.trim();
  const m = VERSION_RE.exec(raw);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : null,
    raw,
  };
}

function isVersion(version) {
  return parse(version) !== null;
}

/**
 * SemVer §11 precedence for the prerelease field. A release (null) sorts
 * above any prerelease of the same triple; numeric identifiers compare
 * numerically and sort below alphanumeric ones.
 */
function comparePrerelease(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1; // a is a prerelease of the same triple → sorts below

  const out = (x) => (x > 0 ? 1 : -1);
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;

    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return out(Number(x) - Number(y));
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * compare(a, b) -> 1 | 0 | -1, or null when either side is not a version.
 * Returning null (rather than throwing or guessing) is what lets callers skip
 * unusable input instead of reporting a bogus "update available".
 */
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;

  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True only when both are versions and `candidate` is strictly newer. */
function isNewer(candidate, current) {
  return compare(candidate, current) === 1;
}

module.exports = { parse, compare, isNewer, isVersion };
