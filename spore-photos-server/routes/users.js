const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { findSession } = require('../middleware/whitelistCheck');

async function requireAdmin(req, res) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const session = await findSession(deviceToken);
  if (!session || session.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return null; }
  return session;
}

// GET /api/users — list all users with last_login
router.get('/', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const result = await pool.query(
      `SELECT id, username, display_name, role, is_active, created_at, last_login
       FROM users
       ORDER BY username ASC`
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('[Users] List error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// ── GET /api/users/list ──────────────────────────────────────────
// List all active users for share modal user picker (any authenticated user)

router.get('/list', async (req, res) => {
  try {
    const deviceToken = req.cookies.device_token;
    if (!deviceToken) return res.status(401).json({ error: 'Not authenticated' });
    const session = await findSession(deviceToken);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    const result = await pool.query(
      `SELECT id, username, display_name
       FROM users
       WHERE is_active = true AND id != $1
       ORDER BY username ASC`,
      [session.user_id]
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('[Users] List share users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /api/users/:userId/whitelist — get whitelist entries for a user
router.get('/:userId/whitelist', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { userId } = req.params;

    // Query ip_addresses for this user — through session links
    const ipResult = await pool.query(
      `SELECT DISTINCT ia.id, ia.ip, ia.whitelisted, ia.blacklisted, ia.notes, ia.create_date, ia.update_date
       FROM sessions s
       LEFT JOIN ip_addresses ia ON ia.id = s.ip_address_id
       WHERE s.user_id = $1 AND ia.id IS NOT NULL`,
      [userId]
    );

    // Query devices via sessions for this user
    const deviceResult = await pool.query(
      `SELECT DISTINCT d.id, d.device_id, d.create_date
       FROM devices d
       JOIN sessions s ON s.device_id = d.id
       WHERE s.user_id = $1`,
      [userId]
    );

    // Query sessions for this user
    const sessionResult = await pool.query(
      `SELECT s.id, s.token, s.create_date, s.expire_date,
              ia.ip, d.device_id
       FROM sessions s
       LEFT JOIN ip_addresses ia ON ia.id = s.ip_address_id
       LEFT JOIN devices d ON d.id = s.device_id
       WHERE s.user_id = $1`,
      [userId]
    );

    res.json({ ip_addresses: ipResult.rows, devices: deviceResult.rows, sessions: sessionResult.rows });
  } catch (error) {
    console.error('[Users] Whitelist error:', error);
    res.status(500).json({ error: 'Failed to fetch whitelist' });
  }
});

// DELETE /api/users/whitelist — remove a whitelist entry by ip
router.delete('/whitelist', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP is required' });

    const result = await pool.query(
      'UPDATE ip_addresses SET whitelisted = false, update_date = NOW() WHERE ip = $1',
      [ip]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'IP address not found' });
    }

    console.log(`[Users] Removed whitelist entry: ${ip}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Whitelist delete error:', error);
    res.status(500).json({ error: 'Failed to delete whitelist entry' });
  }
});

// DELETE /api/users/sessions/:id — remove a session by its DB id
router.delete('/sessions/:id', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const result = await pool.query(
      'DELETE FROM sessions WHERE id = $1',
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log(`[Users] Removed session ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Session delete error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;
