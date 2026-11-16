/**
 * Local phone photos — shared state store (singleton).
 *
 * Owns everything about the phone's own files: the DCIM scan, which files are
 * still missing from the server, each file's upload state, and the auto-backup
 * queue. Both the Photos grid and the Upload tab's checkbox read from here, so
 * the state survives tab switches and is shared across components.
 *
 * States an item can be in:
 *   'pending'   — local only; the user can tap to upload it
 *   'queued'    — waiting its turn in the auto-backup queue
 *   'uploading' — in flight, with a progress percentage
 *   'error'     — last attempt failed; tap to retry
 *
 * Items that finish uploading are removed here (they are server photos now)
 * and announced via onUploaded() so the gallery can show the real thumbnail.
 */

import {
  scanDcimCamera,
  fetchExistingNames,
  uploadBackupFile,
  serverMatchName,
  mimeFromName,
  isNative,
  checkPermissions,
  requestPermissions,
} from './BackupService';

const ENABLED_KEY = 'spore_auto_backup';

let state = {
  supported: false,
  enabled: false,
  scanning: false,
  running: false,
  lastError: null,
  items: [],
};

const listeners = new Set();
const uploadedListeners = new Set();

let initialized = false;
let runningNow = false;
let runToken = 0; // bumped to cancel an in-flight queue

function snapshot() {
  return { ...state, items: state.items.map(i => ({ ...i })) };
}

function emit() {
  const s = snapshot();
  listeners.forEach(l => { try { l(s); } catch { /* listener error must not break the store */ } });
}

function emitUploaded(photo) {
  uploadedListeners.forEach(l => { try { l(photo); } catch {} });
}

export function subscribe(cb) {
  listeners.add(cb);
  cb(snapshot());
  return () => listeners.delete(cb);
}

export function onUploaded(cb) {
  uploadedListeners.add(cb);
  return () => uploadedListeners.delete(cb);
}

export function getState() { return snapshot(); }
export function isEnabled() { return state.enabled; }
export function isSupported() { return state.supported; }

export function init() {
  if (initialized) return;
  initialized = true;
  state.supported = isNative();
  try { state.enabled = localStorage.getItem(ENABLED_KEY) === '1'; } catch {}
  emit();
}

export function setEnabled(v) {
  init();
  state.enabled = !!v;
  try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch {}
  if (!state.enabled) runToken++; // stop a queue that is mid-flight
  emit();
  if (state.enabled) runAutoBackup();
}

// ── Scan + dedup ──────────────────────────────────────────────

function makeItem(f) {
  return {
    key: f.name,
    name: f.name,
    path: f.path,
    size: f.size,
    mtime: f.mtime,
    mime_type: mimeFromName(f.name),
    // ISO string so local tiles sort against the server's date_taken.
    date_taken: new Date(f.mtime).toISOString(),
    state: 'pending',
    progress: 0,
    error: null,
  };
}

export async function refresh() {
  init();
  if (!state.supported) return;
  state.scanning = true;
  state.lastError = null;
  emit();
  try {
    const granted = (await checkPermissions()) || (await requestPermissions());
    if (!granted) {
      state.lastError = 'Storage permission denied — enable it for Spore-Photos in Android Settings.';
      state.items = [];
      return;
    }
    const files = await scanDcimCamera();
    const existing = await fetchExistingNames(files);
    const prev = new Map(state.items.map(i => [i.key, i]));
    state.items = files
      .filter(f => !existing.has(serverMatchName(f.name)))
      .map(f => {
        const live = prev.get(f.name);
        // Preserve in-flight work so a concurrent scan doesn't reset progress.
        if (live && (live.state === 'uploading' || live.state === 'queued')) return live;
        return makeItem(f);
      });
  } catch (e) {
    state.lastError = e?.message || 'Could not scan phone photos';
  } finally {
    state.scanning = false;
    emit();
  }
}

// ── Upload ────────────────────────────────────────────────────

function patchItem(key, patch) {
  const it = state.items.find(i => i.key === key);
  if (it) Object.assign(it, patch);
  emit();
}

function removeItem(key) {
  state.items = state.items.filter(i => i.key !== key);
  emit();
}

async function uploadItem(item) {
  patchItem(item.key, { state: 'uploading', progress: 0, error: null });
  const res = await uploadBackupFile(item, pct => patchItem(item.key, { progress: pct }));
  if (res.ok) {
    removeItem(item.key);
    if (res.photo) emitUploaded(res.photo);
    return true;
  }
  patchItem(item.key, { state: 'error', error: res.error || 'Upload failed', progress: 0 });
  return false;
}

// Manual upload of a single file (tap on a pending tile).
export async function uploadOne(key) {
  init();
  if (!state.supported) return;
  const item = state.items.find(i => i.key === key);
  if (!item) return;
  if (item.state === 'uploading' || item.state === 'queued') return;
  await uploadItem(item);
}

// ── Auto-backup queue ─────────────────────────────────────────

export async function runAutoBackup() {
  init();
  if (!state.supported || !state.enabled || runningNow) return;
  runningNow = true;
  state.running = true;
  const token = ++runToken;
  try {
    await refresh();
    const queue = state.items.filter(i => i.state === 'pending' || i.state === 'error');
    queue.forEach(i => { i.state = 'queued'; });
    emit();
    for (const queued of queue) {
      if (token !== runToken || !state.enabled) break; // cancelled or toggled off
      const item = state.items.find(i => i.key === queued.key);
      if (!item) continue; // already uploaded by a manual tap
      await uploadItem(item);
    }
  } finally {
    runningNow = false;
    state.running = false;
    // Anything still waiting goes back to tap-to-upload rather than staying
    // stuck on "Scheduled".
    state.items.forEach(i => { if (i.state === 'queued') i.state = 'pending'; });
    emit();
  }
}
