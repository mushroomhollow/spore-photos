const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { getState, getToken, tokenMatches, markComplete } = require('../services/setup');
const { issueToken } = require('../services/clientToken');
const { getOrCreateIp, getOrCreateDevice, createSession } = require('../middleware/whitelistCheck');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/**
 * GET /api/setup/status — public. Tells the client whether to show the
 * first-run wizard instead of the login form.
 */
router.get('/status', async (req, res) => {
  try {
    const state = await getState();
    res.json({ needsSetup: state.needsSetup });
  } catch (err) {
    // No schema yet is a normal pre-install state, not a server error.
    res.json({ needsSetup: true, error: 'database not initialised' });
  }
});

/**
 * POST /api/setup — create the first admin.
 * Body: { token, username, password, displayName? }
 *
 * Refuses once any user exists, so it cannot be replayed to add accounts. The
 * requesting IP is whitelisted so the new admin can actually sign in: without
 * that, the 3-tier auth would demand an access code on a brand-new install.
 */
router.post('/', async (req, res) => {
  try {
    const state = await getState();
    if (!state.needsSetup) {
      return res.status(409).json({ error: 'Setup has already been completed.' });
    }

    const { token, username, password, displayName } = req.body || {};

    const expected = await getToken();
    if (!tokenMatches(token, expected)) {
      return res.status(403).json({ error: 'Invalid setup token.' });
    }

    if (!USERNAME_RE.test(String(username || ''))) {
      return res.status(400).json({
        error: 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.',
      });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const display = (displayName && String(displayName).trim()) || username;

    const { rows } = await pool.query(
      `INSERT INTO users (username, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, username, display_name, role`,
      [username, display, passwordHash]
    );

    // Authorise the client that ran setup and sign it in immediately, so the
    // admin does not have to pass the invite-only gate they just created.
    const deviceId = req.headers['x-device-id'] || null;
    const devRec = deviceId ? await getOrCreateDevice(deviceId) : null;
    const clientToken = devRec ? await issueToken(devRec.id) : null;

    if (devRec) {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const ipRec = await getOrCreateIp(req.clientIp || req.ip);
      await pool.query('DELETE FROM sessions WHERE device_id = $1', [devRec.id]);
      await createSession(sessionToken, devRec.id, ipRec.id, rows[0].id, expiresAt);
      res.cookie('device_token', sessionToken, {
        httpOnly: true,
        secure: req.secure,
        sameSite: req.secure ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    await markComplete();

    console.log(`[Setup] Admin user "${username}" created (device ${deviceId || 'none'})`);
    res.json({ success: true, user: rows[0], client_token: clientToken });
  } catch (err) {
    console.error('[Setup] Failed:', err);
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    res.status(500).json({ error: 'Setup failed.' });
  }
});

module.exports = router;