const fs = require('fs-extra');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

async function runMigrations() {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  });

  try {
    console.log('Running database schema migration...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('Schema migration complete.');

    // Incremental migrations, applied in filename order. Every one must be
    // written to be safe to re-run (IF NOT EXISTS / guarded DO blocks).
    const migrations = (await fs.readdir(__dirname))
      .filter(f => /^migrate-.*\.sql$/.test(f))
      .sort();
    for (const file of migrations) {
      const sql = await fs.readFile(path.join(__dirname, file), 'utf8');
      await pool.query(sql);
      console.log(`Applied ${file}`);
    }
  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

async function init() {
  try {
    await runMigrations();
    console.log('Schema is up to date.');
    console.log('No admin account is created automatically.');
    console.log('Start the server and complete first-run setup in the web UI.');
    process.exit(0);
  } catch (err) {
    console.error('Initialization failed:', err);
    process.exit(1);
  }
}

init();
