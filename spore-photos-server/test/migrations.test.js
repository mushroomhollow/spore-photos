/**
 * The migration registry: names carry the release, ordering is SemVer, and a
 * mistake is refused here rather than applied to someone else's database.
 *
 * The database-backed half (apply once, never re-run, failure is fatal) is
 * test/migrations.sh — it needs a real PostgreSQL to be meaningful.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMigration,
  orderMigrations,
  listAvailable,
  LEGACY_MIGRATIONS,
} = require('../db/migrate');

test('a migration filename carries the release it belongs to', () => {
  assert.deepEqual(parseMigration('2.1.0-photo-indexes.sql'), {
    filename: '2.1.0-photo-indexes.sql',
    version: '2.1.0',
    slug: 'photo-indexes',
  });
  assert.equal(parseMigration('v2.1.0-photo-indexes.sql').version, '2.1.0');
  assert.equal(parseMigration('2.10.0-many.sql').version, '2.10.0');
});

test('pre-versioning date-stamped names are refused, never guessed at', () => {
  assert.equal(parseMigration('migrate-20261112-client-tokens.sql'), null);
  assert.equal(parseMigration('2.1.0_underscore.sql'), null);
  assert.equal(parseMigration('nonsense.sql'), null);
  assert.throws(
    () => orderMigrations(['migrate-20261112-client-tokens.sql']),
    /must be <version>-<slug>\.sql/,
  );
});

test('a hyphenated description is part of the description, not a prerelease', () => {
  // The bug this guards: with an optional prerelease in the pattern, greedy
  // matching read `2.1.0-photo-indexes.sql` as version `2.1.0-photo`.
  assert.deepEqual(parseMigration('2.1.0-photo-indexes.sql'), {
    filename: '2.1.0-photo-indexes.sql',
    version: '2.1.0',
    slug: 'photo-indexes',
  });
  assert.deepEqual(parseMigration('9.9.1-probe-table.sql'), {
    filename: '9.9.1-probe-table.sql',
    version: '9.9.1',
    slug: 'probe-table',
  });
});

test('a prerelease version is refused rather than guessed at', () => {
  assert.equal(parseMigration('3.0.0-rc.1-beta.sql'), null);
  assert.throws(() => orderMigrations(['3.0.0-rc.1-beta.sql']), /must be <version>-<slug>\.sql/);
});

test('ordering is SemVer, not lexicographic', () => {
  const versions = orderMigrations(['2.10.0-b.sql', '2.9.0-a.sql', '2.9.1-c.sql'])
    .map((m) => m.version);
  assert.deepEqual(versions, ['2.9.0', '2.9.1', '2.10.0']);
});

test('two files for one release are refused', () => {
  assert.throws(
    () => orderMigrations(['2.1.0-a.sql', '2.1.0-b.sql']),
    /One script per release/,
  );
});

test('non-SQL files are ignored', () => {
  assert.deepEqual(
    orderMigrations(['README.md', '2.1.0-a.sql', '.gitkeep']).map((m) => m.filename),
    ['2.1.0-a.sql'],
  );
});

test('the archived migrations are recorded as applied, never replayed', () => {
  assert.equal(LEGACY_MIGRATIONS.length, 3);
  for (const migration of LEGACY_MIGRATIONS) {
    assert.match(migration.filename, /^migrate-\d{8}-[a-z-]+\.sql$/);
    assert.match(migration.version, /^\d+\.\d+\.\d+$/);
  }
});

test('the shipped migrations directory parses', async () => {
  // Guards the next person: a badly named migration fails `npm test`, not a
  // user's container start.
  const available = await listAvailable();
  assert.ok(Array.isArray(available));
  for (const migration of available) {
    assert.ok(migration.version, `${migration.filename} has no version`);
  }
});
