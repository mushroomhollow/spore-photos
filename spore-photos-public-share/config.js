const path = require('path');
const os = require('os');
const { pick, required, CONFIG_PATH } = require('../config/load');

const ENV = process.env.NODE_ENV || 'development';
const isProd = ENV === 'production';

// No baked-in storage location. The public-share service normally follows the
// photos root configured in the main app (Settings → Storage); this is the
// fallback for a fresh install.
const defaultPicturesRoot = path.join(os.homedir(), 'Pictures', 'spore-photos');

module.exports = {
  env: ENV,
  isProd,
  version: require('../config/version'),

  port: parseInt(pick('PORT', 'publicShare', 'port', isProd ? '4052' : '3052'), 10),

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

  picturesRoot: pick('PICTURES_ROOT', 'storage', 'picturesRoot', defaultPicturesRoot),

  // Trust proxy headers only when a reverse proxy you control sets them.
  trustProxy: String(pick('TRUST_PROXY', 'server', 'trustProxy', false)) === 'true',
};