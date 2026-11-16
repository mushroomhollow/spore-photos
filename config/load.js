/**
 * One place for a deployment's settings.
 *
 * Every service (API server, public-share server, and the client build) reads
 * this file, so a self-hoster edits one file instead of three .env files.
 * Environment variables always win over the file, so container/systemd setups
 * can ignore it entirely.
 *
 * File location (first match):
 *   1. $SPORE_PHOTOS_CONFIG
 *   2. <repo>/config/spore-photos.config.json   (gitignored)
 *
 * Shape — `default` is merged with the section named after NODE_ENV:
 *
 *   {
 *     "default":     { "server": {...}, "database": {...}, "storage": {...} },
 *     "development": { "database": { "name": "spore_photos_dev" } },
 *     "production":  { }
 *   }
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH =
  process.env.SPORE_PHOTOS_CONFIG || path.join(__dirname, 'spore-photos.config.json');

function readConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`[config] Could not read ${CONFIG_PATH}: ${err.message}`);
    return {};
  }
}

const file = readConfigFile();
const envName = process.env.NODE_ENV || 'development';
const active = { ...(file.default || {}), ...(file[envName] || {}) };

/** Value from the config file only, or undefined. */
function fromFile(section, key) {
  const group = active[section];
  return group && group[key] !== undefined ? group[key] : undefined;
}

/**
 * Resolve a setting: env var → config file → fallback.
 * Empty env vars are treated as unset (systemd `Environment=` with no value).
 */
function pick(envKey, section, key, fallback) {
  const envValue = process.env[envKey];
  if (envValue !== undefined && envValue !== '') return envValue;

  const fileValue = fromFile(section, key);
  if (fileValue !== undefined) return fileValue;

  return fallback;
}

/** Same as pick(), but throws a readable error when nothing is configured. */
function required(envKey, section, key, hint) {
  const value = pick(envKey, section, key, undefined);
  if (value === undefined || value === '') {
    const where = `${envKey} or ${section}.${key} in ${CONFIG_PATH}`;
    throw new Error(`${where} is required.${hint ? ` ${hint}` : ''}`);
  }
  return value;
}

module.exports = { CONFIG_PATH, file, envName, active, pick, required };