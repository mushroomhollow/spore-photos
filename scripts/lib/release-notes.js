/**
 * Release notes are files, and `release.json` is generated from them.
 *
 * One file per release, `releases/<version>.md`, with a front-matter block that
 * carries the machine-readable part and prose sections that carry the human
 * part. The file an install actually fetches (`release.json`) is built from it,
 * so the panel, the docs and the release can never tell three different stories.
 *
 * Read `releases/2.0.0.md` for a worked example. The front-matter dialect is
 * deliberately tiny — `key: value`, one level of nesting by indentation,
 * booleans and integers — because a YAML parser is a dependency this does not
 * need. Anything more elaborate is a mistake in the notes file, and is refused
 * with the line that caused it.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const NOTES_DIR = path.join(REPO_ROOT, 'releases');

/** The section whose text becomes `notes` in release.json. */
const SUMMARY_SECTION = 'What this means for your install';
/** The section a breaking release must actually fill in. */
const ACTION_SECTION = 'Action required';

function scalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, '');
}

function parseFrontMatter(text, where) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new Error(`${where}: needs a front-matter block — the file must start with a line containing only ---`);
  }

  const data = {};
  let parent = null;

  match[1].split('\n').forEach((rawLine, index) => {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) return;

    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon === -1) {
      throw new Error(`${where}: line ${index + 2} of the front matter is not "key: value" — "${line}"`);
    }

    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    if (!indented) {
      if (value === '') {
        parent = {};
        data[key] = parent;
      } else {
        data[key] = scalar(value);
        parent = null;
      }
    } else {
      if (!parent) {
        throw new Error(`${where}: "${key}" is indented but the line above it is not a section header`);
      }
      parent[key] = scalar(value);
    }
  });

  return { data, body: match[2] };
}

/** `## Title` … up to the next `## ` ⇒ { Title: text } */
function parseSections(body) {
  const sections = {};
  const parts = body.split(/^##[ \t]+/m).slice(1);

  for (const part of parts) {
    const newline = part.indexOf('\n');
    const title = (newline === -1 ? part : part.slice(0, newline)).trim();
    const text = (newline === -1 ? '' : part.slice(newline + 1)).trim();
    sections[title] = text;
  }

  return sections;
}

function parse(text, where = 'release notes') {
  const { data, body } = parseFrontMatter(text, where);
  const sections = parseSections(body);

  return {
    data,
    sections,
    /** One paragraph, for the panel. */
    summary: (sections[SUMMARY_SECTION] || '').replace(/\s*\n\s*/g, ' ').trim(),
    action: sections[ACTION_SECTION] || '',
  };
}

function pathFor(version) {
  return path.join(NOTES_DIR, `${version}.md`);
}

/** Read and parse `releases/<version>.md`. Throws if it is missing. */
function read(version) {
  const file = pathFor(version);
  if (!fs.existsSync(file)) {
    throw new Error(
      `no release notes for ${version}: expected ${path.relative(REPO_ROOT, file)}.\n` +
      '  Write the notes for a release as part of preparing it — they are what the\n' +
      '  operator is shown, and release.json is generated from them.',
    );
  }
  return { ...parse(fs.readFileSync(file, 'utf8'), path.relative(REPO_ROOT, file)), file };
}

/** Every version with a notes file, oldest first. */
function listVersions() {
  if (!fs.existsSync(NOTES_DIR)) return [];
  return fs.readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort((a, b) => require('../../spore-photos-server/lib/semver').compare(a, b));
}

/**
 * The release.json this notes file produces. Used both to write the file and to
 * check that the committed one has not drifted from its source.
 */
function toReleaseJson(version) {
  const { data, summary } = read(version);
  const upgrade = data.upgrade || {};
  const android = data.android || {};

  // The migration this release ships, if any, so the panel can name the file
  // that will run rather than warning about migrations in the abstract. The
  // release gate refuses a mismatch between this and the notes' flag.
  const migrationsDir = path.join(REPO_ROOT, 'spore-photos-server', 'db', 'migrations');
  const mine = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.startsWith(`${version}-`) && f.endsWith('.sql'))
    : [];

  const json = {
    _comment: 'Describes this release to other installs. Read by the Version & Updates panel when an operator points their server at a URL serving this file. Generated from releases/<version>.md by scripts/build-release-json.js — edit the notes file, not this one.',
    version,
    released: data.released || null,
    notes: summary,
    upgrade: {
      breaking: upgrade.breaking === true,
      migrations: upgrade.migrations === true,
      backupFirst: upgrade.backupFirst === true,
    },
    android: {
      version: android.version || version,
      rebuild: android.rebuild === true,
    },
  };

  if (mine.length === 1) json.upgrade.migration = mine[0];
  if (upgrade.minFrom) json.upgrade.minFrom = String(upgrade.minFrom);
  if (data.url) json.url = data.url;

  return json;
}

module.exports = {
  REPO_ROOT,
  NOTES_DIR,
  SUMMARY_SECTION,
  ACTION_SECTION,
  parse,
  read,
  listVersions,
  toReleaseJson,
  pathFor,
};
