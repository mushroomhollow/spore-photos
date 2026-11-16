const path = require('path');
const os = require('os');
const { pick, required, CONFIG_PATH } = require('../config/load');

// ── Environment ──────────────────────────────────────────────
const ENV = process.env.NODE_ENV || 'development';
const isProd = ENV === 'production';

// ── Photo storage ────────────────────────────────────────────
// No storage location is baked in. Set PICTURES_ROOT (or storage.picturesRoot
// in config/spore-photos.config.json). The fallback is a plain per-user
// directory so a fresh clone still starts.
const defaultPicturesRoot = path.join(os.homedir(), 'Pictures', 'spore-photos');

// ── Exported config ──────────────────────────────────────────
const config = {
  env: ENV,
  isProd,
  version: require('../config/version'),

  // Server
  port: parseInt(pick('PORT', 'server', 'port', isProd ? '4051' : '3051'), 10),
  // Same-origin deployments need no CORS at all. Set this only when the SPA is
  // served from a different origin (e.g. the Vite dev server on 3050).
  corsOrigin: pick('CORS_ORIGIN', 'server', 'corsOrigin', ''),
  // Trust X-Forwarded-Proto / X-Forwarded-For / X-Real-IP only when a reverse
  // proxy you control sets them. When false the socket address is used, so a
  // client cannot forge its IP (or forge HTTPS).
  trustProxy: String(pick('TRUST_PROXY', 'server', 'trustProxy', false)) === 'true',

  // Database connection. No credentials are baked in — a deployment supplies
  // them via env or the config file, otherwise the server refuses to start.
  db: {
    host: pick('PG_HOST', 'database', 'host', 'localhost'),
    port: parseInt(pick('PG_PORT', 'database', 'port', '5432'), 10),
    database: pick('PG_DATABASE', 'database', 'name', isProd ? 'spore_photos' : 'spore_photos_dev'),
    user: pick('PG_USER', 'database', 'user', 'spore_photos'),
    password: required(
      'PG_PASSWORD',
      'database',
      'password',
      `Set PG_PASSWORD, or database.password in ${CONFIG_PATH}.`
    ),
  },

  // Absolute path to server/data/ for runtime files
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),

  // Photo storage root
  picturesRoot: pick('PICTURES_ROOT', 'storage', 'picturesRoot', defaultPicturesRoot),

  // One-time token required to create the first admin account. When unset, the
  // server generates one on first boot and prints it to the log.
  setupToken: pick('SETUP_TOKEN', 'setup', 'token', ''),
};

module.exports = config;