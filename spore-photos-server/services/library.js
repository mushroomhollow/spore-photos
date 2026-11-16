// Reconcile the photos table with what is actually on disk under the photos root.
//
// Disk layout being walked (see services/ingest.js for how files get there):
//   <picturesRoot>/<username>/<YYYYMM>/<YYYYMMDD>_<uuid>_orig.<ext>   <- defines a photo
//                                          ..._thumb.jpg, ..._prev.jpg <- derived, ignored
//
// For every _orig file found: if the photos table has no row for that relative
// path, insert one. For every photos row whose file is no longer on disk,
// delete the row. No files are ever moved, renamed or deleted — this only syncs
// the database to the filesystem.
//
// Deleting a photos row cascades safely: album_photos and share_tokens are
// ON DELETE CASCADE, and albums.cover_photo_id is ON DELETE SET NULL.
//
// SAFETY: if the root yields zero photo files while the table is non-empty,
// that is what an unmounted share or a misconfigured root looks like. Deleting
// then would wipe the library, so this refuses instead.

const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const pool = require('../db/pool');
const config = require('../config');
const { mimeFromFilename, IS_VIDEO } = require('./ingest');

const UNSORTED_DIRNAME = 'Unsorted';

// <YYYYMMDD>_<uuid-v4>_orig.<ext>
const ORIG_RE = /^(\d{8})_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_orig(\.[A-Za-z0-9]+)$/;

// 'YYYYMMDD' -> 'YYYY-MM-DD'
function dateFromStamp(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

async function walkDir(root, relDir, found, unrecognized) {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;

    if (e.isDirectory()) {
      // The Unsorted drop folder is an inbox, not part of the library.
      if (!relDir && e.name === UNSORTED_DIRNAME) continue;
      await walkDir(root, rel, found, unrecognized);
      continue;
    }

    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().includes('_orig.')) continue;  // only the original defines a photo

    const match = e.name.match(ORIG_RE);
    if (!match) {
      unrecognized.push(rel);
      continue;
    }

    let stat = null;
    try { stat = await fs.stat(path.join(root, rel)); } catch {}

    const parts = rel.split('/');
    // Legacy trees put the owner first: <username>/<YYYYMM>/<file>.
    const legacyUser = parts.length >= 3 ? parts[0] : null;
    const monthFolder = parts.length >= 2
      ? parts[parts.length - 2]
      : dateFromStamp(match[1]).replace(/-/g, '').slice(0, 6);

    found.set(rel, {
      relativePath: rel,
      legacyUser,
      monthFolder,
      filename: e.name,
      uuid: match[2],
      dateTaken: dateFromStamp(match[1]),
      size: stat ? stat.size : null,
    });
  }
}

async function walkDisk(root) {
  const found = new Map();   // relative_path -> disk record
  const unrecognized = [];   // looks like a photo but doesn't match the naming scheme

  try {
    await fs.readdir(root);
  } catch (e) {
    throw Object.assign(new Error(`Cannot read photos root: ${e.message}`), { status: 400 });
  }

  await walkDir(root, '', found, unrecognized);
  return { found, unrecognized };
}

async function scanLibrary() {
  const root = config.picturesRoot;

  if (!await fs.pathExists(root)) {
    throw Object.assign(new Error(`Photos root does not exist: ${root}`), { status: 400 });
  }

  const { found: disk, unrecognized } = await walkDisk(root);

  const dbRes = await pool.query('SELECT id, relative_path FROM photos');
  const dbRows = dbRes.rows;

  if (disk.size === 0 && dbRows.length > 0) {
    throw Object.assign(
      new Error(
        `Refusing to reconcile: found 0 photo files under ${root} but the database holds ` +
        `${dbRows.length} records. Check that the storage is mounted and the photos root is correct.`
      ),
      { status: 409 }
    );
  }

  const dbPaths = new Set(dbRows.map(r => r.relative_path));
  const toRemove = dbRows.filter(r => !disk.has(r.relative_path));
  const toAdd = [...disk.values()].filter(d => !dbPaths.has(d.relativePath));

  // Ownership for newly discovered files: a legacy per-user tree names its
  // owner in the first path segment; in the flat layout everything belongs to
  // the instance owner (the oldest admin). The library is shared either way.
  const users = new Map();
  let ownerId = null;
  if (toAdd.length > 0) {
    const userRes = await pool.query(
      "SELECT id, username FROM users ORDER BY (role = 'admin') DESC, created_at ASC"
    );
    for (const r of userRes.rows) users.set(r.username, r.id);
    ownerId = userRes.rows[0]?.id || null;
  }

  let added = 0;
  const addedSamples = [];
  const unmatched = [];   // file sits under a directory with no matching user
  const errors = [];

  for (const d of toAdd) {
    const rel = d.relativePath;
    const userId = (d.legacyUser && users.get(d.legacyUser)) || ownerId;
    if (!userId) { unmatched.push(rel); continue; }

    const mimeType = mimeFromFilename(d.filename) || 'application/octet-stream';

    // Dimensions for images; videos left null (a full ffprobe pass per file is too slow here).
    let width = null;
    let height = null;
    if (!IS_VIDEO(mimeType)) {
      try {
        const meta = await sharp(path.join(root, rel)).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {}
    }

    try {
      await pool.query(
        `INSERT INTO photos (user_id, original_filename, uuid_name, date_taken, month_folder, relative_path, mime_type, file_size, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        // original_filename is not recoverable from disk (the file was renamed on
        // ingest), so the on-disk name is used as the best available label.
        [userId, d.filename, d.uuid, d.dateTaken, d.monthFolder, rel, mimeType, d.size, width, height]
      );
      added++;
      if (addedSamples.length < 20) addedSamples.push(rel);
    } catch (e) {
      errors.push({ file: rel, error: e.message });
    }
  }

  let removed = 0;
  if (toRemove.length > 0) {
    const del = await pool.query(
      'DELETE FROM photos WHERE id = ANY($1::uuid[])',
      [toRemove.map(r => r.id)]
    );
    removed = del.rowCount;
  }

  console.log(
    `[Library] Scanned ${root}: ${disk.size} files on disk, ${dbRows.length} DB rows ` +
    `-> added ${added}, removed ${removed}, unmatched ${unmatched.length}, errors ${errors.length}`
  );

  return {
    photos_root: root,
    disk_files: disk.size,
    db_rows: dbRows.length,
    added,
    removed,
    unchanged: dbRows.length - toRemove.length,
    unmatched,
    unrecognized,
    errors,
    added_samples: addedSamples,
    removed_samples: toRemove.slice(0, 20).map(r => r.relative_path),
  };
}

module.exports = { scanLibrary, UNSORTED_DIRNAME };
