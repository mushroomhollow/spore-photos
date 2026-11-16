const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const pool = require('../db/pool');
const config = require('../config');
const { ingestBuffer, ALLOWED_MIMES, mimeFromFilename } = require('../services/ingest');
const { scanLibrary } = require('../services/library');

const { findSession } = require('../middleware/whitelistCheck');

// Unsorted import folder name, directly under the photos root.
const UNSORTED_DIRNAME = 'Unsorted';

// Multer: store in memory for sharp processing.
// Keep MAX_UPLOAD_MB in step with the client's guard (UploadZone.jsx) and with
// client_max_body_size in the reverse proxy — a mismatch shows up as a
// confusing 413 or a silently skipped file.
const MAX_UPLOAD_MB = 200;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// Multer rejects oversized files by calling next(err) before the route runs, so
// turn it into a clear 413 instead of a generic 500.
const uploadSingle = (req, res, next) =>
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File too large — the limit is ${MAX_UPLOAD_MB} MB per file.`,
        code: 'file_too_large',
        max_mb: MAX_UPLOAD_MB,
      });
    }
    return next(err);
  });

// ── Helpers ─────────────────────────────────────────────────

async function getAuthUser(req) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) return null;
  const session = await findSession(deviceToken);
  if (!session) return null;
  return session;
}

// ── POST /api/photos/upload ──────────────────────────────────

router.post('/upload', uploadSingle, async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file provided' });
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Unsupported type. Use JPEG, PNG, WebP, GIF, or video.' });
    }

    const userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [auth.user_id]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

    const photo = await ingestBuffer({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      userId: user.id,
      username: user.username,
      dateTaken: new Date(),
    });

    res.json({
      success: true,
      photo: { ...photo, urls: buildUrls(photo.id, req) },
    });
  } catch (error) {
    console.error('[Photos] Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── GET /api/photos ──────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const typeFilter = req.query.type;     // 'photo', 'video', or undefined
    const yearFilter = req.query.year;     // e.g. '2025' or undefined
    const albumFilter = req.query.album;   // 'none' or specific UUID or undefined

    // Build dynamic WHERE clause
    const conditions = ['user_id = $1'];
    const params = [auth.user_id];
    let paramIdx = 2;

    if (typeFilter === 'photo') {
      conditions.push("mime_type LIKE 'image/%'");
    } else if (typeFilter === 'video') {
      conditions.push("mime_type LIKE 'video/%'");
    }

    if (yearFilter) {
      conditions.push(`EXTRACT(YEAR FROM date_taken) = $${paramIdx}::int`);
      params.push(parseInt(yearFilter, 10));
      paramIdx++;
    }

    if (albumFilter === 'none') {
      conditions.push('id NOT IN (SELECT photo_id FROM album_photos)');
    } else if (albumFilter && albumFilter.length === 36) {
      // Specific album UUID — photos in this album only
      conditions.push(`id IN (SELECT photo_id FROM album_photos WHERE album_id = $${paramIdx}::uuid)`);
      params.push(albumFilter);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM photos WHERE ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT id, original_filename, date_taken, mime_type, file_size, width, height, created_at
       FROM photos WHERE ${whereClause}
       ORDER BY date_taken DESC, created_at DESC, id DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    // Fetch distinct years for the year dropdown
    const yearsResult = await pool.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM date_taken)::int AS year
       FROM photos WHERE user_id = $1
       ORDER BY year DESC`,
      [auth.user_id]
    );
    const years = yearsResult.rows.map(r => r.year);

    const photos = result.rows.map(p => ({ ...p, urls: buildUrls(p.id, req) }));
    res.json({ photos, total, hasMore: offset + photos.length < total, years });
  } catch (error) {
    console.error('[Photos] List error:', error);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

// ── GET /api/photos/:id/file/:type ──────────────────────────

router.get('/:id/file/:type', async (req, res) => {
  try {
    const { id, type } = req.params;
    if (!['thumb', 'prev', 'orig'].includes(type)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    const result = await pool.query('SELECT relative_path, original_filename FROM photos WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });
    const { relative_path: rel, original_filename: origName } = result.rows[0];
    const suffix = type === 'thumb' ? 'thumb' : 'prev';
    const filePath = type === 'orig'
      ? path.join(config.picturesRoot, rel)
      : path.join(config.picturesRoot, rel.replace('_orig', `_${suffix}`).replace(/\.\w+$/, '.jpg'));

    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Send original with original filename for proper downloads
    if (type === 'orig') {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(origName)}"`);
    }

    res.sendFile(filePath);
  } catch (error) {
    console.error('[Photos] File serve error:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// ── GET /api/photos/download-zip?ids=id1,id2,... ────────────

router.get('/download-zip', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const ids = req.query.ids ? req.query.ids.split(',') : [];
    if (ids.length === 0) return res.status(400).json({ error: 'No photo IDs provided' });

    const result = await pool.query(
      `SELECT DISTINCT p.id, p.relative_path, p.original_filename
       FROM photos p
       WHERE p.id = ANY($1::uuid[])
         AND (
           p.user_id = $2
           OR EXISTS (
             SELECT 1 FROM album_photos ap
             JOIN album_user_share aus ON aus.album_id = ap.album_id
             WHERE ap.photo_id = p.id AND aus.shared_with_user_id = $2
           )
         )`,
      [ids, auth.user_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'No photos found' });

    const { ZipArchive } = require('archiver');
    const archive = new ZipArchive({ zlib: { level: 6 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="spore-photos-${ids.length}-${Date.now()}.zip"`);

    archive.pipe(res);

    for (const photo of result.rows) {
      const filePath = path.join(config.picturesRoot, photo.relative_path);
      if (await fs.pathExists(filePath)) {
        archive.file(filePath, { name: photo.original_filename });
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('[Photos] Zip error:', error);
    res.status(500).json({ error: 'Failed to create zip' });
  }
});

// ── GET /api/photos/unsorted-info ────────────────────────────
// Lightweight status for the Settings > Import Photos panel. Available to any
// authenticated user (the import itself targets that user's library).
router.get('/unsorted-info', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const unsortedDir = path.join(config.picturesRoot, UNSORTED_DIRNAME);
    const exists = await fs.pathExists(unsortedDir);

    let totalFiles = 0;
    let supportedFiles = 0;
    let subdirectories = 0;
    let pending = [];

    if (exists) {
      const entries = await fs.readdir(unsortedDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
      subdirectories = entries.filter(e => e.isDirectory()).length;
      totalFiles = files.length;

      const supportedNames = files
        .map(e => e.name)
        .filter(name => {
          const mime = mimeFromFilename(name);
          return mime && ALLOWED_MIMES.includes(mime);
        });
      supportedFiles = supportedNames.length;

      if (supportedNames.length > 0) {
        const existing = await pool.query(
          `SELECT DISTINCT original_filename FROM photos
           WHERE user_id = $1 AND original_filename = ANY($2::text[])`,
          [auth.user_id, supportedNames]
        );
        const have = new Set(existing.rows.map(r => r.original_filename));
        pending = supportedNames.filter(n => !have.has(n));
      }
    }

    res.json({
      unsorted_dir: unsortedDir,
      exists,
      total_files: totalFiles,
      supported_files: supportedFiles,
      subdirectories,
      pending_count: pending.length,
      pending: pending.slice(0, 50),
    });
  } catch (error) {
    console.error('[Photos] Unsorted info error:', error);
    res.status(500).json({ error: 'Failed to inspect Unsorted folder' });
  }
});

// ── POST /api/photos/scan-unsorted ───────────────────────────
// Import everything in <picturesRoot>/Unsorted into the CALLING user's library
// using the normal ingest pipeline, then remove each file from Unsorted.
// Files that fail are left in place so nothing is lost.
router.post('/scan-unsorted', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [auth.user_id]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

    const unsortedDir = path.join(config.picturesRoot, UNSORTED_DIRNAME);

    if (!await fs.pathExists(unsortedDir)) {
      return res.json({
        success: true,
        unsorted_dir: unsortedDir,
        scanned: 0,
        ingested: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        skipped_details: [],
        subdirectories_ignored: [],
        photos: [],
        message: `No Unsorted folder found at ${unsortedDir}`,
      });
    }

    const entries = await fs.readdir(unsortedDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
    const subdirectories = entries.filter(e => e.isDirectory()).map(e => e.name);

    let ingested = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    const skippedDetails = [];
    const importedPhotos = [];

    for (const entry of files) {
      const srcPath = path.join(unsortedDir, entry.name);

      const mimetype = mimeFromFilename(entry.name);
      if (!mimetype || !ALLOWED_MIMES.includes(mimetype)) {
        skipped++;
        skippedDetails.push({ file: entry.name, reason: 'unsupported type' });
        continue;
      }

      // Dedup against this user's library — same rule the upload/backup flow uses.
      const dup = await pool.query(
        'SELECT id FROM photos WHERE user_id = $1 AND original_filename = $2 LIMIT 1',
        [user.id, entry.name]
      );
      if (dup.rows.length > 0) {
        skipped++;
        skippedDetails.push({ file: entry.name, reason: 'already in library' });
        continue;
      }

      try {
        const buffer = await fs.readFile(srcPath);
        const stat = await fs.stat(srcPath);

        const photo = await ingestBuffer({
          buffer,
          originalname: entry.name,
          mimetype,
          userId: user.id,
          username: user.username,
          dateTaken: stat.mtime,
        });

        // Only remove from Unsorted once the file is safely ingested.
        await fs.remove(srcPath);

        ingested++;
        importedPhotos.push({
          id: photo.id,
          filename: entry.name,
          date_taken: photo.date_taken,
          mime_type: photo.mime_type,
          urls: buildUrls(photo.id, req),
        });
      } catch (e) {
        failed++;
        errors.push({ file: entry.name, error: e.message });
        console.error(`[Photos] Unsorted import failed for ${entry.name}:`, e.message);
      }
    }

    console.log(`[Photos] Unsorted scan by ${user.username}: ${ingested} imported, ${skipped} skipped, ${failed} failed`);

    res.json({
      success: true,
      unsorted_dir: unsortedDir,
      scanned: files.length,
      ingested,
      skipped,
      failed,
      errors,
      skipped_details: skippedDetails,
      subdirectories_ignored: subdirectories,
      photos: importedPhotos,
    });
  } catch (error) {
    console.error('[Photos] Unsorted scan error:', error);
    res.status(500).json({ error: 'Failed to scan Unsorted folder' });
  }
});

// ── POST /api/photos/scan-library ────────────────────────────
// Reconcile the photos table against the files actually present under the
// photos root: insert a row for every photo on disk that has none, and delete
// the row for every photo whose file is gone. No files are moved or deleted.
router.post('/scan-library', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const summary = await scanLibrary();
    res.json({ success: true, ...summary });
  } catch (error) {
    console.error('[Photos] Library scan error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to scan photo library' });
  }
});

// ── DELETE /api/photos/:id ───────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const result = await pool.query(
      'SELECT relative_path, user_id FROM photos WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });

    const photo = result.rows[0];
    if (photo.user_id !== auth.user_id) {
      return res.status(403).json({ error: 'Not authorized to delete this photo' });
    }

    const rel = photo.relative_path; // e.g. "mushroom/202507/uuid_orig.jpg"
    const dir = path.dirname(rel);
    const baseBody = path.basename(rel).replace('_orig', '');

    // Delete all three file variants
    const filesToDelete = [
      path.join(config.picturesRoot, rel),
      path.join(config.picturesRoot, dir, baseBody.replace(/\.\w+$/, '_thumb.jpg')),
      path.join(config.picturesRoot, dir, baseBody.replace(/\.\w+$/, '_prev.jpg')),
    ];

    for (const f of filesToDelete) {
      try { await fs.remove(f); } catch {}
    }

    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);

    console.log(`[Photos] Deleted: ${rel}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Photos] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// ── POST /api/photos/check-existing ──────────────────────────
// Lightweight dedup check: given an array of filenames, return
// which ones already exist in this user's library.
// Used by the mobile backup service to skip already-uploaded files.
router.post('/check-existing', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const { filenames } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.json({ existing: [] });
    }

    const result = await pool.query(
      `SELECT DISTINCT original_filename FROM photos
       WHERE user_id = $1 AND original_filename = ANY($2::text[])`,
      [auth.user_id, filenames]
    );

    res.json({ existing: result.rows.map(r => r.original_filename) });
  } catch (error) {
    console.error('[Photos] Check existing error:', error);
    res.status(500).json({ error: 'Failed to check existing photos' });
  }
});

// Same-origin RELATIVE URLs. Do NOT reintroduce a scheme or the request host:
// the Vite dev proxy sets changeOrigin, so the API sees Host: localhost:3051,
// and `https://localhost:3051` cannot load from the plain-http dev site — every
// thumbnail and preview silently fails. Relative also works on prod (nginx) and
// in the Capacitor shell (origin = the prod domain).
function buildUrls(id) {
  return {
    thumb: `/api/photos/${id}/file/thumb`,
    preview: `/api/photos/${id}/file/prev`,
    original: `/api/photos/${id}/file/orig`,
  };
}

module.exports = router;
