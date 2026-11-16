// The photos root is owned by the main app: when an admin changes it in
// Settings > Storage, the main server writes app_settings['photos_root'].
// This server renders the public share pages, so it must read from exactly the
// same root — otherwise a share link would look for files in a folder the
// gallery no longer uses.
//
// Falls back to this process's own PICTURES_ROOT when nothing is stored, so a
// fresh install (no app_settings row) behaves exactly as before.

const pool = require('./db/pool');
const config = require('./config');

async function applyStoredPhotosRoot() {
  try {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = 'photos_root'");
    const stored = r.rows.length && r.rows[0].value ? String(r.rows[0].value).trim() : null;
    if (stored) config.picturesRoot = stored;
  } catch (e) {
    // Table may not exist yet on a fresh install — the env value stands.
    console.warn(`[Share] Could not read app_settings.photos_root: ${e.message}`);
  }
  console.log(`[Share] photos_root: ${config.picturesRoot}`);
  return config.picturesRoot;
}

module.exports = { applyStoredPhotosRoot };
