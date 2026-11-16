// Server-wide application settings (key/value in the app_settings table).
//
// The setting that matters here is the photos root: the folder this server
// reads photos from and writes uploads into.
//
// Resolution:
//   1. app_settings['photos_root'] — set from Settings > Storage
//   2. the value this process started with (PICTURES_ROOT env, or config.js)
//
// There is intentionally NO baked-in storage location. Whoever deploys this
// points it at their own storage, either through the UI or through their own
// environment. Nothing here assumes a particular NAS or directory layout.
//
// Changes apply live: every route reads config.picturesRoot per request, so a
// change made through the API takes effect immediately, with no restart.

const path = require('path');
const fs = require('fs-extra');
const pool = require('../db/pool');
const config = require('../config');

const PHOTOS_ROOT_KEY = 'photos_root';

// Captured at load, before any stored override is applied.
const initialPicturesRoot = config.picturesRoot;

// ── Low-level key/value access ───────────────────────────────

async function getSetting(key) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].value : null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

// ── Photos root ──────────────────────────────────────────────

// Stored override, or null. Fails soft so a missing app_settings table (e.g.
// migration not yet applied) just leaves the startup value in place.
async function getStoredPhotosRoot() {
  try {
    const v = await getSetting(PHOTOS_ROOT_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch (e) {
    console.warn(`[Settings] Could not read ${PHOTOS_ROOT_KEY}: ${e.message}`);
    return null;
  }
}

// Called once at boot, before any route serves a request.
async function applyStoredPhotosRoot() {
  const stored = await getStoredPhotosRoot();
  config.picturesRoot = stored || initialPicturesRoot;
  console.log(`[Settings] photos_root: ${config.picturesRoot}`);
  return { applied: Boolean(stored), photosRoot: config.picturesRoot };
}

async function setPhotosRoot(newRoot) {
  const normalized = path.resolve(newRoot);
  await setSetting(PHOTOS_ROOT_KEY, normalized);
  config.picturesRoot = normalized;
  console.log(`[Settings] photos_root set to: ${normalized}`);
  return normalized;
}

// Snapshot for the Settings UI.
async function describe() {
  return {
    photos_root: config.picturesRoot,
    unsorted_dir: path.join(config.picturesRoot, 'Unsorted'),
    exists: await fs.pathExists(config.picturesRoot),
  };
}

module.exports = {
  PHOTOS_ROOT_KEY,
  getSetting,
  setSetting,
  getStoredPhotosRoot,
  applyStoredPhotosRoot,
  setPhotosRoot,
  describe,
};
