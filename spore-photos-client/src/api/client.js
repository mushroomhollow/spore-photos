import axios from 'axios';

// Device ID: unique identifier for this browser/device
// Generated once, stored in localStorage
function getDeviceId() {
  let id = localStorage.getItem('spore_device_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    localStorage.setItem('spore_device_id', id);
  }
  return id;
}

// Client token: issued by the server on a successful authentication. This is
// the credential behind "remember this device" (auto-login) and it is what
// proves this client is authorised. The device id above is only a label.
const CLIENT_TOKEN_KEY = 'spore_client_token';

export function getClientToken() {
  return localStorage.getItem(CLIENT_TOKEN_KEY);
}

function setClientToken(token) {
  if (token) localStorage.setItem(CLIENT_TOKEN_KEY, token);
}

// Any response that signs a client in returns its token exactly once.
function absorbToken(data) {
  if (data && data.client_token) setClientToken(data.client_token);
  return data;
}

// Always relative: the mobile app loads its whole UI from whichever server the
// user configured (Settings → Server), so the API is same-origin. On the web
// this resolves against the current origin / Vite proxy. Never hardcode a host
// here — a hardcoded prod host makes a phone pointed at a self-hosted server
// silently keep talking to production.
const apiBaseUrl = '/api';

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});

// Device label + client token on every request. X-Requested-With is required by
// the server on mutations and doubles as CSRF protection: a cross-site form
// cannot set custom headers.
api.interceptors.request.use(config => {
  config.headers['X-Device-ID'] = getDeviceId();
  const token = getClientToken();
  if (token) config.headers['X-Client-Token'] = token;
  config.headers['X-Requested-With'] = 'XMLHttpRequest';
  return config;
});

// ─── Auth check ──────────────────────────────────────────
// Returns { status: 'auto_login'|'login_required'|'code_required'|'blacklisted', user?, ... }
export async function checkAuth() {
  const { data } = await api.post('/auth/check');
  return data;
}

// ─── First-run setup ─────────────────────────────────────
// The instance has no accounts yet: the UI shows the setup wizard instead of
// the login form.
export async function fetchSetupStatus() {
  const { data } = await api.get('/setup/status');
  return data;
}

export async function submitSetup({ token, username, password, displayName }) {
  const { data } = await api.post('/setup', { token, username, password, displayName });
  return absorbToken(data);
}

// ─── Login with username + password ──────────────────────
export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  return absorbToken(data);
}

// ─── Validate an access code ─────────────────────────────
// Returns { success, reg_token } or errors with remaining attempts
export async function checkCode(code) {
  const { data } = await api.post('/auth/check-code', { code });
  return data;
}

// ─── Register after access code ──────────────────────────
export async function registerFromCode(regToken, username, password, displayName) {
  const { data } = await api.post('/auth/register-from-code', {
    reg_token: regToken,
    username,
    password,
    display_name: displayName,
  });
  return absorbToken(data);
}

// ─── Logout ──────────────────────────────────────────────
export async function logout() {
  // Only the session ends. The client token is this device's credential and
  // stays, so signing out returns to the password form rather than demanding a
  // new access code.
  const { data } = await api.post('/auth/logout');
  return data;
}

// ─── Check current session ───────────────────────────────
export async function checkSession() {
  const { data } = await api.post('/auth/me');
  return data;
}

// ─── Change password ─────────────────────────────────────
export async function changePassword(currentPassword, newPassword) {
  const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
  return data;
}

// ─── User management (admin) ─────────────────────────────
export async function fetchUsers() {
  const { data } = await api.get('/users');
  return data;
}

export async function fetchUserWhitelist(userId) {
  const { data } = await api.get(`/users/${userId}/whitelist`);
  return data;
}

export async function deleteWhitelistEntry(ip) {
  const { data } = await api.delete('/users/whitelist', { data: { ip } });
  return data;
}

export async function deleteSession(sessionId) {
  const { data } = await api.delete(`/users/sessions/${sessionId}`);
  return data;
}

// ─── Set password from code (existing user) ──────────────
export async function setPasswordFromCode(regToken, password) {
  const { data } = await api.post('/auth/set-password-from-code', { reg_token: regToken, password });
  return absorbToken(data);
}

// ─── Access Codes ────────────────────────────────────────
export async function fetchAccessCodes() {
  const { data } = await api.get('/access-codes');
  return data;
}

export async function createAccessCode(label, expiresInHours, maxUses, targetUserId) {
  const { data } = await api.post('/access-codes/generate', { label, expiresInHours, maxUses, targetUserId });
  return data;
}

export async function deleteAccessCode(id) {
  const { data } = await api.delete(`/access-codes/${id}`);
  return data;
}

// ─── Health ──────────────────────────────────────────────
export async function healthCheck() {
  const { data } = await api.get('/health');
  return data;
}

// ─── Photos ──────────────────────────────────────────────
// Largest file the server accepts (routes/photos.js MAX_UPLOAD_MB) — checked
// here first so an oversized video fails instantly instead of after a long
// upload. Keep in step with client_max_body_size in the reverse proxy.
export const MAX_UPLOAD_MB = 200;

export async function uploadPhoto(file, onProgress) {
  const formData = new FormData();
  formData.append('photo', file);
  try {
    const { data } = await api.post('/photos/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
    });
    return data;
  } catch (err) {
    // Enrich error with debug info
    const status = err?.response?.status || '';
    const body = err?.response?.data?.error || err?.response?.data?.message || '';
    const code = err?.code || '';
    const msg = err?.message || 'Unknown error';
    err.debugInfo = `status=${status} code=${code} body=${body} msg=${msg}`;
    console.error('[uploadPhoto]', err.debugInfo, err);
    throw err;
  }
}

export async function fetchPhotos(params = {}) {
  const { data } = await api.get('/photos', { params });
  return data;
}

export async function deletePhoto(id) {
  const { data } = await api.delete(`/photos/${id}`);
  return data;
}

export async function sharePhoto(id) {
  const { data } = await api.post(`/photos/${id}/share`);
  return data;
}

// ─── Albums ──────────────────────────────────────────────
export async function fetchAlbums() {
  const { data } = await api.get('/albums');
  return data;
}

export async function createAlbum(name, description) {
  const { data } = await api.post('/albums', { name, description });
  return data;
}

export async function addPhotosToAlbum(albumId, photoIds) {
  const { data } = await api.put(`/albums/${albumId}/photos`, { photo_ids: photoIds });
  return data;
}

export async function fetchAlbum(albumId, params = {}) {
  const { data } = await api.get(`/albums/${albumId}`, { params });
  return data;
}

export async function deleteAlbum(albumId) {
  const { data } = await api.delete(`/albums/${albumId}`);
  return data;
}

export async function updateAlbum(albumId, updates) {
  const { data } = await api.put(`/albums/${albumId}`, updates);
  return data;
}

export async function removePhotoFromAlbum(albumId, photoId) {
  const { data } = await api.delete(`/albums/${albumId}/photos/${photoId}`);
  return data;
}

export async function removePhotosFromAlbum(albumId, photoIds) {
  const { data } = await api.delete(`/albums/${albumId}/photos`, { data: { photo_ids: photoIds } });
  return data;
}

export async function shareAlbum(albumId) {
  const { data } = await api.post(`/albums/${albumId}/share-album`);
  return data;
}

export async function revokeAlbumShare(albumId) {
  const { data } = await api.delete(`/albums/${albumId}/share-album`);
  return data;
}

// ─── Album Collections ──────────────────────────────────────
export async function fetchCollections() {
  const { data } = await api.get('/albums/collections');
  return data;
}

export async function createCollection(name) {
  const { data } = await api.post('/albums/collections', { name });
  return data;
}

export async function deleteCollection(collectionId) {
  const { data } = await api.delete(`/albums/collections/${collectionId}`);
  return data;
}

export async function fetchStats() {
  const { data } = await api.get('/stats');
  return data;
}

// ─── User-to-User Share ──────────────────────────────────────
export async function fetchAllUsers() {
  const { data } = await api.get('/users/list');
  return data;
}

export async function shareAlbumWithUser(albumId, userId) {
  const { data } = await api.post(`/albums/${albumId}/share-user`, { user_id: userId });
  return data;
}

export async function revokeAlbumUserShare(albumId, userId) {
  const { data } = await api.delete(`/albums/${albumId}/share-user/${userId}`);
  return data;
}

export async function fetchAlbumSharedUsers(albumId) {
  const { data } = await api.get(`/albums/${albumId}/shared-users`);
  return data;
}

export async function fetchSharedAlbums() {
  const { data } = await api.get('/albums/shared-with-me');
  return data;
}

export async function removeSharedAlbum(shareId) {
  const { data } = await api.delete(`/albums/shared-with-me/${shareId}`);
  return data;
}

export async function fetchAlbumsWithPhotoInfo(photoIds) {
  const { data } = await api.post('/albums/batch-info', { photo_ids: photoIds });
  return data;
}

// ─── Preferences ─────────────────────────────────────────────
export async function fetchPreferences() {
  const { data } = await api.get('/auth/preferences');
  return data.preferences;
}

export async function updatePreferences(prefs) {
  const { data } = await api.put('/auth/preferences', prefs);
  return data.preferences;
}

// ─── App Settings (admin) ────────────────────────────────────
// Server-wide settings. Backed by the app_settings table.
export async function fetchAppSettings() {
  const { data } = await api.get('/settings');
  return data;
}

export async function updatePhotosRoot(photosRoot) {
  const { data } = await api.put('/settings/photos-root', { photos_root: photosRoot });
  return data;
}

// ─── Unsorted import ─────────────────────────────────────────
// Importing targets the calling user's own library.
export async function fetchUnsortedInfo() {
  const { data } = await api.get('/photos/unsorted-info');
  return data;
}

export async function scanUnsorted() {
  const { data } = await api.post('/photos/scan-unsorted');
  return data;
}

// Reconcile the photos table with the files actually stored under the photos root.
// Inserts rows for photos on disk that are missing from the DB, and deletes rows
// for photos whose files are gone.
export async function scanLibrary() {
  const { data } = await api.post('/photos/scan-library');
  return data;
}

export default api;
