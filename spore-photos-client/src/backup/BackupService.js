/**
 * Spore-Photos Mobile — local file scanning + upload.
 *
 * Scans the phone's DCIM/Camera folder and uploads files to the Spore-Photos
 * API using the existing authenticated axios client. Uses Capacitor native
 * plugins when available; every function is a graceful no-op in the browser.
 *
 * Consumed by src/backup/localStore.js, which owns all UI state.
 */

import { Capacitor } from '@capacitor/core';
import api, { MAX_UPLOAD_MB } from '../api/client';

const DCIM_PATH = 'DCIM/Camera/';

// Matches the server's ingest allow-list (spore-photos-server/services/ingest.js).
const SUPPORTED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.gif', '.mp4', '.mov', '.webm',
]);

const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

// nginx allows 100M per request; larger files would also blow up the base64
// read in the WebView, so refuse them up front instead of crashing.
// Single source of truth lives in api/client.js; keep the two in step.
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export function ext(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function mimeFromName(name) {
  return EXT_MIME[ext(name)] || 'application/octet-stream';
}

export function isSupportedExt(name) {
  return SUPPORTED_EXT.has(ext(name));
}

export function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * The name the server will store this file under.
 * ingest.js rewrites HEIC/HEIF originals to .jpg, so dedup has to compare on
 * that rewritten name — otherwise IMG_1.HEIC never matches a stored IMG_1.jpg
 * and gets re-uploaded on every app open.
 */
export function serverMatchName(name) {
  return name.replace(/\.(heic|heif)$/i, '.jpg');
}

// ── Permissions ──

export async function requestPermissions() {
  if (!isNative()) return false;
  try {
    const { Filesystem } = await import('@capacitor/filesystem');
    const r = await Filesystem.requestPermissions();
    return r.publicStorage === 'granted';
  } catch { return false; }
}

export async function checkPermissions() {
  if (!isNative()) return false;
  try {
    const { Filesystem } = await import('@capacitor/filesystem');
    const r = await Filesystem.checkPermissions();
    return r.publicStorage === 'granted';
  } catch { return false; }
}

// ── Scan DCIM/Camera ──

export async function scanDcimCamera() {
  if (!isNative()) return [];
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const result = await Filesystem.readdir({ path: DCIM_PATH, directory: Directory.ExternalStorage });
  const files = [];
  for (const item of result.files) {
    // Skip hidden files, trash, and anything unsupported (incl. subdirectories,
    // which have no extension).
    if (item.name.startsWith('.') || /\.trash/i.test(item.name)) continue;
    if (!isSupportedExt(item.name)) continue;
    try {
      const stat = await Filesystem.stat({ path: DCIM_PATH + item.name, directory: Directory.ExternalStorage });
      files.push({ name: item.name, path: DCIM_PATH + item.name, size: stat.size, mtime: stat.mtime });
    } catch { /* skip unreadable entries */ }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

// ── Dedup: which of these files are already on the server? ──
// Returns a Set of SERVER-MATCH names (see serverMatchName).

export async function fetchExistingNames(files) {
  if (!files || files.length === 0) return new Set();
  try {
    const filenames = files.map(f => serverMatchName(f.name));
    const { data } = await api.post('/photos/check-existing', { filenames });
    return new Set(data.existing || []);
  } catch {
    return new Set();
  }
}

// ── Upload one file ──
// onProgress(pct) is called with 0-100 while the request is in flight.

export async function uploadBackupFile(file, onProgress) {
  if (!isNative()) return { ok: false, error: 'Not running on Android' };
  if (file.size && file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_UPLOAD_MB} MB)` };
  }
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const readResult = await Filesystem.readFile({ path: file.path, directory: Directory.ExternalStorage });
    const data = readResult.data || readResult;
    const byteChars = atob(data);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);

    // The part's content type IS the mimetype the server validates against —
    // sending everything as image/jpeg makes videos and HEIC fail ingest.
    const mime = mimeFromName(file.name);
    const blob = new Blob([bytes], { type: mime });

    const fd = new FormData();
    fd.append('photo', blob, file.name);

    const { data: res } = await api.post('/photos/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100))); }
        : undefined,
    });
    return { ok: true, photo: res?.photo };
  } catch (err) {
    // Prefer the human-readable message over a raw code. A Capacitor plugin
    // failure (e.g. Filesystem.readFile) surfaces its real detail in
    // `err.message` — e.g. "readFile failed with: <actual reason>" — while
    // err.code is just a generic "OS-PLUG-FILE-XXXX". Show the message so the
    // user sees WHY, plus the file size for the large-file case.
    const serverMsg = err?.response?.data?.error || err?.response?.data?.message || '';
    let error;
    if (serverMsg) error = String(serverMsg);
    else if (err?.message) error = String(err.message);
    else if (err?.code) error = `Upload failed (${err.code})`;
    else error = 'Upload failed';
    if (file.size) error += ` — ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    console.error(`[Backup] Upload error for ${file.name}: ${error}`, err);
    return { ok: false, error };
  }
}
