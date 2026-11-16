const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const { constants: fsConstants } = require('fs');
const { findSession } = require('../middleware/whitelistCheck');
const settings = require('../services/settings');

// Same admin gate pattern as routes/users.js
async function requireAdmin(req, res) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const session = await findSession(deviceToken);
  if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return null; }
  return session;
}

// ─── GET /api/settings ─────────────────────────────────────────────
// Current photos root and the Unsorted path derived from it.
router.get('/', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    res.json(await settings.describe());
  } catch (error) {
    console.error('[Settings] Read error:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// ─── PUT /api/settings/photos-root ─────────────────────────────────
// Set the server's photos root. Does NOT move or rewrite any existing files —
// photos already in the DB resolve relative to the new root, so anything not
// present there will 404 until it is moved.
router.put('/photos-root', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const raw = req.body?.photos_root;
    if (typeof raw !== 'string' || !raw.trim()) {
      return res.status(400).json({ error: 'A photos root path is required' });
    }

    if (!path.isAbsolute(raw.trim())) {
      return res.status(400).json({ error: 'Path must be an absolute path, e.g. /path/to/your/photo/library' });
    }

    const candidate = path.resolve(raw.trim());

    // Must be creatable/usable before we commit to it.
    try {
      await fs.ensureDir(candidate);
      await fs.access(candidate, fsConstants.W_OK);
    } catch (e) {
      return res.status(400).json({ error: `Path is not usable: ${e.message}` });
    }

    await settings.setPhotosRoot(candidate);
    res.json({ success: true, ...(await settings.describe()) });
  } catch (error) {
    console.error('[Settings] Update photos root error:', error);
    res.status(500).json({ error: 'Failed to update photos root' });
  }
});

module.exports = router;
