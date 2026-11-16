/**
 * Native file operations that only make sense inside the Android shell.
 *
 * These complement BackupService (which scans + uploads). All of them are
 * graceful no-ops in the browser: `isNative()` gates the plugin calls, and the
 * download helper falls back to a normal browser download when not native.
 *
 *   saveToDcim             — write a downloaded file into DCIM/Camera via the
 *                            SporeFiles native plugin (MediaStore-indexed).
 *   deleteLocalByServerName — delete a DCIM/Camera file whose name matches a
 *                            server photo's `original_filename`.
 *   downloadPhoto          — the single entry point the UI calls: fetches the
 *                            original bytes and saves them (native) or triggers
 *                            a browser download (web).
 */

import { registerPlugin } from '@capacitor/core';
import { isNative } from './BackupService';

const SporeFiles = registerPlugin('SporeFiles');

// Limit for saving a file back to the phone (base64 in memory), not the
// upload limit — that is MAX_UPLOAD_MB in api/client.js.
const MAX_BYTES = 100 * 1024 * 1024;

export { isNative };

export async function saveToDcim(filename, base64Data, mimeType) {
  if (!isNative()) return { ok: false, error: 'Not running on Android' };
  try {
    const res = await SporeFiles.saveToDcim({ filename, base64Data, mimeType });
    return { ok: !!res?.ok, uri: res?.uri };
  } catch (e) {
    return { ok: false, error: e?.message || 'Save to DCIM failed' };
  }
}

export async function deleteLocalByServerName(serverFilename) {
  if (!isNative()) return { ok: true, deleted: false };
  try {
    const res = await SporeFiles.deleteLocal({ serverFilename });
    return { ok: !!res?.ok, deleted: !!res?.deleted, matchedName: res?.matchedName };
  } catch (e) {
    return { ok: false, error: e?.message || 'Local delete failed' };
  }
}

/**
 * Read the current Android permission state. On the web (or fallback) it
 * reports everything granted so the UI shows no missing-permission affordances.
 * Returns `{ allFilesAccess: boolean, media: 'granted' | 'denied' }`.
 */
export async function getPermissionState() {
  if (!isNative()) return { allFilesAccess: true, media: 'granted' };
  try {
    const res = await SporeFiles.checkPermissionState();
    return {
      allFilesAccess: res?.allFilesAccess !== false,
      media: res?.media === 'granted' ? 'granted' : 'denied',
    };
  } catch {
    return { allFilesAccess: false, media: 'denied' };
  }
}

/** Open the app's detail page in Android Settings (Photos & media toggle). */
export async function openAppPermissions() {
  if (!isNative()) return;
  try { await SporeFiles.openAppSettings(); } catch { /* user cancelled */ }
}

/** Open the special "All files access" screen for this app. */
export async function openAllFilesAccessSettings() {
  if (!isNative()) return;
  try { await SporeFiles.openAllFilesAccess(); } catch { /* user cancelled */ }
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function triggerWebDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download a photo to the device (native → DCIM/Camera) or as a normal browser
 * download (web). `photo` is a server photo object with `urls.original`,
 * `original_filename` and `mime_type`.
 *
 * Returns `{ ok: boolean, kind: 'native' | 'web', error?: string }`.
 */
export async function downloadPhoto(photo) {
  if (!isNative()) {
    triggerWebDownload(photo.urls.original, photo.original_filename);
    return { ok: true, kind: 'web' };
  }

  try {
    // Same-origin fetch (server.url = prod domain) carries the session cookie.
    const resp = await fetch(photo.urls.original, { credentials: 'include' });
    if (!resp.ok) return { ok: false, kind: 'native', error: `HTTP ${resp.status}` };
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, kind: 'native', error: 'File too large to save on device (max 100 MB)' };
    }
    const base64 = arrayBufferToBase64(buf);
    const res = await saveToDcim(photo.original_filename, base64, photo.mime_type);
    return { ok: res.ok, kind: 'native', error: res.ok ? undefined : res.error };
  } catch (e) {
    return { ok: false, kind: 'native', error: e?.message || 'Download failed' };
  }
}