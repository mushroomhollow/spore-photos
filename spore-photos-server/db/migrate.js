/**
 * Release-versioned migrations, applied exactly once.
 *
 * A migration belongs to a release, and its filename says which:
 *
 *     db/migrations/2.1.0-photo-indexes.sql
 *                   └─────┘ └───────────┘
 *                   release  what it does
 *
 * What changed from the previous scheme: migrations used to be *re-run on every
 * start*, which meant every file had to be safe to replay forever, and a release
 * that dropped something could be undone by re-running an older file after a
 * newer one had rebuilt it. Now each file runs once, on the release that carries
 * it, and `schema_migrations` records that it did.
 *
 *   - schema.sql describes the schema a *new* install gets. It runs on every
 *     boot (it is written with IF NOT EXISTS throughout) and is the only thing a
 *     fresh install needs.
 *   - a migration exists for installs that already have data. It runs once.
 *
 * Ordering is SemVer, not lexicographic, so 2.10.0 comes after 2.9.0. A file
 * whose version cannot be parsed is refused rather than guessed at — including a
 * prerelease version, which cannot be told apart from a hyphenated description.
 *
 * Failure is fatal on purpose: the caller exits non-zero so a half-migrated
 * database never gets an application pointed at it. Already-applied files are
 * never touched, so a failure only ever concerns the new ones.
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const semver = require('../lib/semver');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

/**
 * `2.1.0-photo-indexes.sql` → { version: '2.1.0', slug: 'photo-indexes' }
 *
 * The version is a plain release version — no prerelease suffix. Allowing one
 * would make `2.1.0-rc.1-beta.sql` ambiguous: is that release 2.1.0-rc.1 with an
 * unreadable slug, or release 2.1.0 whose slug is `rc.1-beta`? A wrong guess here
 * decides whether a migration runs, so prereleases are refused by name instead.
 * Migrations travel with tagged releases.
 */
const MIGRATION_RE = /^(v?\d+\.\d+\.\d+)-([a-z0-9][a-z0-9-]*)\.sql$/;

/**
 * Migrations that shipped before this directory existed, applied by the old
 * re-run-everything runner. Their effects are all in schema.sql now and every
 * install has run them, so the first run under this scheme records them as
 * applied instead of replaying them (db/archive/ keeps the files themselves).
 */
const LEGACY_MIGRATIONS = [
  { filename: 'migrate-20260720-share-rebuild.sql', version: '1.7.0' },
  { filename: 'migrate-20261020-app-settings.sql', version: '1.8.0' },
  { filename: 'migrate-20261112-client-tokens.sql', version: '1.9.0' },
];

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    version    TEXT NOT NULL,
    checksum   TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

function checksumOf(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

/** True when the tracking table exists. */
async function hasTable(pool) {
  const { rowCount } = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'schema_migrations'
  `);
  return rowCount > 0;
}

/** True when the tracking table was created by this call. */
async function ensureTable(pool) {
  if (await hasTable(pool)) return false;

  await pool.query(CREATE_TABLE_SQL);
  return true;
}

/** Record the pre-versioning migrations, so they are never replayed. */
async function baselineLegacy(pool) {
  for (const { filename, version } of LEGACY_MIGRATIONS) {
    await pool.query(
      `INSERT INTO schema_migrations (filename, version, checksum)
       VALUES ($1, $2, NULL)
       ON CONFLICT (filename) DO NOTHING`,
      [`archive/${filename}`, version],
    );
  }
  return LEGACY_MIGRATIONS.map((m) => m.filename);
}

/** `2.1.0-photo-indexes.sql` → { filename, version, slug }; null if unorderable. */
function parseMigration(filename) {
  const m = MIGRATION_RE.exec(filename);
  if (!m) return null;
  return { filename, version: m[1].replace(/^v/, ''), slug: m[2] };
}

/**
 * Order a list of filenames as they must be applied (SemVer, oldest first).
 * Throws on a name it cannot order, or two files for one release — both are
 * authoring mistakes that would otherwise be applied in an arbitrary order, on
 * someone else's database.
 */
function orderMigrations(filenames) {
  const parsed = [];

  for (const filename of filenames.filter((f) => f.endsWith('.sql'))) {
    const migration = parseMigration(filename);
    if (!migration) {
      throw new Error(
        `Migration filename must be <version>-<slug>.sql, e.g. 2.1.0-photo-indexes.sql — got "${filename}". ` +
        'The release it belongs to has to be readable from the name.',
      );
    }
    parsed.push(migration);
  }

  parsed.sort((a, b) => semver.compare(a.version, b.version));

  for (let i = 1; i < parsed.length; i += 1) {
    if (semver.compare(parsed[i - 1].version, parsed[i].version) === 0) {
      throw new Error(
        `Two migrations claim ${parsed[i].version}: ${parsed[i - 1].filename} and ${parsed[i].filename}. ` +
        'One script per release — fold them into one file.',
      );
    }
  }

  return parsed;
}

/** Every migration file on disk, in the order it must be applied. */
async function listAvailable() {
  let entries = [];
  try {
    entries = await fs.readdir(MIGRATIONS_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  return orderMigrations(entries);
}

async function appliedRows(pool) {
  const { rows } = await pool.query(
    'SELECT filename, version, checksum, applied_at FROM schema_migrations ORDER BY applied_at, filename',
  );
  return rows;
}

async function pendingMigrations(pool) {
  const [available, applied] = [await listAvailable(), await appliedRows(pool)];
  const done = new Set(applied.map((r) => r.filename));
  return available.filter((m) => !done.has(m.filename));
}

/**
 * Applied migrations whose file no longer matches what was applied. Not an
 * error — the recorded change is in the database either way — but it means
 * someone edited a migration after it shipped, so say so instead of staying
 * quiet about it.
 */
async function changedAfterApply(pool) {
  const applied = (await appliedRows(pool)).filter((r) => r.checksum && !r.filename.startsWith('archive/'));
  const available = await listAvailable();
  const byName = new Map(available.map((m) => [m.filename, m]));
  const changed = [];

  for (const row of applied) {
    const file = byName.get(row.filename);
    if (!file) continue; // deleted file: reported as missing, not changed
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, row.filename), 'utf8');
    if (checksumOf(sql) !== row.checksum) changed.push(row.filename);
  }

  return changed;
}

/** Recorded migrations whose file is gone from db/migrations/. */
async function missingFiles(pool) {
  const applied = (await appliedRows(pool)).filter((r) => !r.filename.startsWith('archive/'));
  const available = new Set((await listAvailable()).map((m) => m.filename));
  return applied.filter((r) => !available.has(r.filename)).map((r) => r.filename);
}

/** What is applied, what is pending, and anything worth mentioning. */
async function status(pool) {
  const available = await listAvailable();

  // A database that has never run a migration has no table to read. That is a
  // normal state (a brand-new install, or --status before the first apply), not
  // an error — report every file as pending.
  if (!(await hasTable(pool))) {
    return { applied: [], pending: available, changed: [], missing: [], untracked: true };
  }

  return {
    applied: await appliedRows(pool),
    pending: await pendingMigrations(pool),
    changed: await changedAfterApply(pool),
    missing: await missingFiles(pool),
    untracked: false,
  };
}

/**
 * Apply the schema, then every migration this database has not run yet.
 *
 * `log` is injected so the CLI and the tests can capture output.
 */
async function migrate(pool, { log = () => {} } = {}) {
  log('Running database schema migration...');
  await pool.query(await fs.readFile(SCHEMA_FILE, 'utf8'));
  log('Schema migration complete.');

  const created = await ensureTable(pool);
  if (created) {
    const baselined = await baselineLegacy(pool);
    log(`Tracking migrations from here on (recorded ${baselined.length} earlier ones as applied).`);
  }

  const pending = await pendingMigrations(pool);

  if (!pending.length) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
    log(`No pending migrations (${rows[0].n} recorded).`);
    return { applied: [], pending: [] };
  }

  log(`Applying ${pending.length} migration${pending.length === 1 ? '' : 's'}:`);
  const applied = [];

  for (const migration of pending) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, migration.filename), 'utf8');
    log(`  v${migration.version} — ${migration.filename}`);
    await pool.query(sql);
    await pool.query(
      `INSERT INTO schema_migrations (filename, version, checksum) VALUES ($1, $2, $3)
       ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
      [migration.filename, migration.version, checksumOf(sql)],
    );
    applied.push(migration);
  }

  return { applied, pending };
}

module.exports = {
  migrate,
  status,
  listAvailable,
  parseMigration,
  orderMigrations,
  pendingMigrations,
  appliedRows,
  ensureTable,
  hasTable,
  baselineLegacy,
  changedAfterApply,
  missingFiles,
  checksumOf,
  MIGRATIONS_DIR,
  MIGRATION_RE,
  LEGACY_MIGRATIONS,
};
