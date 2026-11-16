const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');

const TOKEN_KEY = 'setup_token';

async function readSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

async function writeSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

async function countUsers() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  return rows[0].n;
}

/**
 * Setup is required while the instance has no user accounts. Creating the first
 * admin through POST /api/setup is the only way in — there is no seeded account
 * and no default password.
 */
async function getState() {
  const users = await countUsers();
  return { needsSetup: users === 0, userCount: users };
}

/**
 * The one-time token that authorises creating the first admin.
 *
 * SETUP_TOKEN (env) or setup.token (config file) wins. Otherwise a token is
 * generated once, stored in app_settings so it survives restarts, and printed
 * in the server log — the same discoverability model Jellyfin uses for its
 * first-run wizard.
 */
async function getToken() {
  if (config.setupToken) return config.setupToken;

  let token = await readSetting(TOKEN_KEY);
  if (!token) {
    const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
    token = raw.match(/.{1,4}/g).join('-');
    await writeSetting(TOKEN_KEY, token);
  }
  return token;
}

/** Constant-time comparison so the token can't be probed by timing. */
function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function markComplete() {
  await pool.query('DELETE FROM app_settings WHERE key = $1', [TOKEN_KEY]);
}

module.exports = { getState, getToken, tokenMatches, markComplete };