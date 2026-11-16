// Shared photo ingest pipeline.
//
// Extracted from the original POST /api/photos/upload handler so that BOTH the
// browser upload (multer in-memory buffer) and the Unsorted-directory import
// use a single code path. Do not duplicate this logic elsewhere.
//
// For every photo, three files are written as siblings under the flat layout:
//   <picturesRoot>/<YYYYMM>/<YYYYMMDD>_<uuid>_orig.<ext>
//   <picturesRoot>/<YYYYMM>/<YYYYMMDD>_<uuid>_thumb.jpg   (300px)
//   <picturesRoot>/<YYYYMM>/<YYYYMMDD>_<uuid>_prev.jpg    (1200px)
//
// The database stores the path relative to the photos root
// (<YYYYMM>/<filename>) so the root stays movable. Trees written by older
// versions (<username>/<YYYYMM>/<filename>) are still read correctly.

const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const crypto = require('crypto');
const { spawn } = require('child_process');
const pool = require('../db/pool');
const config = require('../config');

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
];

const IS_VIDEO = m => m.startsWith('video/');

// Extension -> MIME map. Needed for Unsorted imports, where there is no
// client-supplied mimetype (multer supplies one for browser uploads).
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.webm': 'video/webm', '.mov': 'video/quicktime',
};

function mimeFromFilename(name) {
  return EXT_MIME[path.extname(name).toLowerCase()] || null;
}

// ── Video frame extraction helpers ────────────────────────────

function extractVideoFrame(input) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(input);
    const inputArg = isBuffer ? 'pipe:0' : input;
    const chunks = [];
    const ff = spawn('ffmpeg', [
      '-i', inputArg,
      '-ss', '00:00:01',
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '5',
      'pipe:1',
    ], { stdio: isBuffer ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
    ff.stdout.on('data', c => chunks.push(c));
    ff.stderr.on('data', () => {}); // drain stderr to avoid backpressure
    ff.on('error', reject);
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      const frame = Buffer.concat(chunks);
      if (code === 0 && frame.length > 0) return resolve(frame);
      // Fallback: try frame 0
      const chunks2 = [];
      const ff2 = spawn('ffmpeg', [
        '-i', inputArg, '-ss', '0', '-vframes', '1',
        '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', 'pipe:1',
      ], { stdio: isBuffer ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
      ff2.stdout.on('data', c => chunks2.push(c));
      ff2.stderr.on('data', () => {});
      ff2.on('error', reject);
      ff2.on('exit', c2 => {
        const f2 = Buffer.concat(chunks2);
        if (c2 === 0 && f2.length > 0) resolve(f2);
        else reject(new Error(`ffmpeg fallback exit ${c2}, ${f2.length} bytes`));
      });
      if (isBuffer) { try { ff2.stdin.end(input); } catch {} }
      ff2.stdin.on('error', () => {});
    };
    ff.on('exit', finish);
    if (isBuffer) { try { ff.stdin.end(input); } catch {} }
    ff.stdin.on('error', () => {});
  });
}

function getVideoMetadata(buffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const fp = spawn('ffprobe', [
      '-i', 'pipe:0', '-v', 'quiet',
      '-print_format', 'json', '-show_streams', '-select_streams', 'v:0',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    fp.stdout.on('data', c => chunks.push(c));
    fp.stdout.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        const s = data.streams?.[0];
        if (s) resolve({ width: s.width, height: s.height, duration: parseFloat(s.duration || 0) });
        else reject(new Error('No video stream'));
      } catch (e) { reject(e); }
    });
    fp.on('error', reject);
    fp.on('exit', code => { if (code) reject(new Error(`ffprobe exit ${code}`)); });
    try { fp.stdin.end(buffer); } catch {}
    fp.stdin.on('error', () => {});
  });
}

// ── Ingest ───────────────────────────────────────────────────
// Store one in-memory file into a user's library and insert its photos row.
// Returns the inserted row (id, original_filename, date_taken, mime_type,
// file_size, width, height, created_at). Callers add urls themselves.
//
// dateTaken: optional Date used for date_taken and the YYYYMM folder. Uploads
// pass the current time; Unsorted imports pass the file's mtime so a bulk copy
// of older photos doesn't land entirely in the current month.

async function ingestBuffer({ buffer, originalname, mimetype, userId, username, dateTaken }) {
  let originalName = originalname;
  let mimeType = mimetype;
  let fileBuffer = buffer;

  // Convert HEIC/HEIF originals to JPEG immediately
  const isHeic = mimeType === 'image/heic' || mimeType === 'image/heif';
  if (isHeic) {
    const jpegBuf = await sharp(fileBuffer).jpeg({ quality: 92 }).toBuffer();
    fileBuffer = jpegBuf;
    mimeType = 'image/jpeg';
    // Update originalname extension to .jpg
    originalName = originalName.replace(/\.(heic|heif)$/i, '.jpg');
  }

  const date = (dateTaken instanceof Date && !isNaN(dateTaken)) ? dateTaken : new Date();
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const monthFolder = dateStr.slice(0, 6);
  const uuid = crypto.randomUUID();
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  const fileSize = fileBuffer.length;

  // Directories — one shared library, no per-user tree:
  //   <picturesRoot>/<YYYYMM>/<name>
  const origDir = path.join(config.picturesRoot, monthFolder);
  await fs.ensureDir(origDir);

  // Filenames
  const origName = `${dateStr}_${uuid}_orig${ext}`;
  const thumbName = `${dateStr}_${uuid}_thumb.jpg`;
  const prevName  = `${dateStr}_${uuid}_prev.jpg`;

  // Save original first (before ffmpeg — allows reading from file, not pipe)
  const origPath = path.join(origDir, origName);
  await fs.writeFile(origPath, fileBuffer);

  // Get dimensions and generate thumb/preview
  let metadata;
  if (IS_VIDEO(mimeType)) {
    metadata = await getVideoMetadata(fileBuffer);
    // Try extracting a thumbnail from the saved file (more reliable than pipe)
    try {
      const frame = await extractVideoFrame(origPath);
      await sharp(frame)
        .resize(300, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(path.join(origDir, thumbName));
      await sharp(frame)
        .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(path.join(origDir, prevName));
    } catch (frameErr) {
      console.warn(`[Ingest] Thumbnail generation skipped for ${origName}: ${frameErr.message}`);
    }
  } else {
    metadata = await sharp(fileBuffer).metadata();
    // Generate thumbnail 300px
    await sharp(fileBuffer)
      .resize(300, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(path.join(origDir, thumbName));
    // Generate preview 1200px
    await sharp(fileBuffer)
      .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(path.join(origDir, prevName));
  }

  const relativePath = `${monthFolder}/${origName}`;

  const result = await pool.query(
    `INSERT INTO photos (user_id, original_filename, uuid_name, date_taken, month_folder, relative_path, mime_type, file_size, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, original_filename, date_taken, mime_type, file_size, width, height, created_at`,
    [userId, originalName, uuid, date, monthFolder, relativePath, mimeType, fileSize, metadata.width, metadata.height]
  );

  const photo = result.rows[0];
  console.log(`[Ingest] Stored: ${origName} (${(fileSize / 1024 / 1024).toFixed(1)} MB) for ${username}`);
  return photo;
}

module.exports = {
  ingestBuffer,
  ALLOWED_MIMES,
  EXT_MIME,
  mimeFromFilename,
  IS_VIDEO,
};
