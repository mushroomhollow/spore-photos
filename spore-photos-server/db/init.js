#!/usr/bin/env node
/**
 * Apply the schema, then any database migrations this install has not run.
 *
 *   npm run db:init              apply (the installer and the container
 *                                entrypoint both run this)
 *   npm run db:status            report only — what is applied, what is pending
 *   node db/init.js --json       that report, machine-readable
 *
 * One migration runs once. A migration belongs to the release that ships it
 * (db/migrations/<version>-<slug>.sql) and is recorded in `schema_migrations`
 * when it is applied, so restarting the service never re-runs it.
 *
 * Exits non-zero if a migration fails, so the container entrypoint stops rather
 * than pointing an application at a half-migrated database.
 */

const { Pool } = require('pg');
const config = require('../config');
const { migrate, status } = require('./migrate');

function makePool() {
  return new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  });
}

function when(ts) {
  return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '';
}

function printStatus(s) {
  if (s.untracked) {
    console.log('No migrations have been applied here yet.');
  } else {
    console.log(`Applied (${s.applied.length}):`);
    for (const row of s.applied) {
      console.log(`  v${String(row.version).padEnd(8)} ${row.filename.padEnd(46)} ${when(row.applied_at)}`);
    }
  }

  console.log(`Pending (${s.pending.length}):`);
  for (const m of s.pending) {
    console.log(`  v${String(m.version).padEnd(8)} ${m.filename}`);
  }

  for (const filename of s.changed) {
    console.log(`  ! ${filename} has changed since it was applied. Its change is already in this database and it will not run again.`);
  }
  for (const filename of s.missing) {
    console.log(`  ! ${filename} is recorded as applied but is no longer in db/migrations/.`);
  }

  if (!s.pending.length) console.log('Nothing to apply.');
}

async function main() {
  const args = process.argv.slice(2);
  const pool = makePool();

  try {
    if (args.includes('--status') || args.includes('--json')) {
      const s = await status(pool);
      if (args.includes('--json')) {
        console.log(JSON.stringify({
          untracked: s.untracked,
          pending: s.pending.map((m) => ({ version: m.version, filename: m.filename })),
          applied: s.applied.map((r) => ({ version: r.version, filename: r.filename, appliedAt: r.applied_at })),
          changedAfterApply: s.changed,
          missingFiles: s.missing,
        }, null, 2));
      } else {
        printStatus(s);
      }
      return;
    }

    await migrate(pool, { log: (message) => console.log(message) });
    console.log('Schema is up to date.');
    console.log('No admin account is created automatically.');
    console.log('Start the server and complete first-run setup in the web UI.');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
