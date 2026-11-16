const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const pool = require('../db/pool');
const config = require('../config');
const { findSession } = require('../middleware/whitelistCheck');

async function getAuthUser(req) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) return null;
  const session = await findSession(deviceToken);
  if (!session) return null;
  return session;
}

// ── POST /api/photos/:id/share — generate share token ───────
// Authenticated — stays on main server (used by ShareModal)

router.post('/photos/:id/share', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    // Verify photo belongs to user
    const photo = await pool.query(
      'SELECT id FROM photos WHERE id = $1 AND user_id = $2',
      [req.params.id, auth.user_id]
    );
    if (photo.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });

    // Check if already shared
    const existing = await pool.query(
      'SELECT token FROM share_tokens WHERE photo_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())',
      [req.params.id]
    );
    if (existing.rows.length > 0) {
      const token = existing.rows[0].token;
      return res.json({ success: true, url: `/share/${token}`, token });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO share_tokens (photo_id, token, created_by) VALUES ($1, $2, $3)',
      [req.params.id, token, auth.user_id]
    );

    res.json({ success: true, url: `/share/${token}`, token });
  } catch (error) {
    console.error('[Share] Generate error:', error);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// ── DELETE /api/photos/:id/share — revoke share token ───────
// Authenticated — stays on main server

router.delete('/photos/:id/share', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    await pool.query(
      'UPDATE share_tokens SET is_active = false WHERE photo_id = $1 AND created_by = $2',
      [req.params.id, auth.user_id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Share] Revoke error:', error);
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

module.exports = router;
