const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const config = require('../config');
const { findSession } = require('../middleware/whitelistCheck');

const DATA_DIR = config.dataDir;

async function requireAdminSession(req) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) return null;
  const session = await findSession(deviceToken);
  if (!session || session.role !== 'admin') return null;
  return session;
}

// Helper: generate a human-readable access code
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// POST /api/access-codes/generate — admin creates a temp code
router.post('/generate', async (req, res) => {
  try {
    const admin = await requireAdminSession(req);
    if (!admin) return res.status(401).json({ error: 'Admin access required' });

    const { label, expiresInHours, maxUses, targetUserId } = req.body;
    const hours = parseInt(expiresInHours) || 24;
    const plainCode = generateCode();
    const codeHash = await bcrypt.hash(plainCode, 10);
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO access_codes (code_hash, label, expires_at, max_uses, created_by, target_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [codeHash, label || 'Shared access', expiresAt, maxUses || null, admin.user_id, targetUserId || null]
    );

    console.log(`[Access Codes] Generated: ${plainCode} (${hours}h, ${maxUses || 'unlimited'} uses)`);
    res.json({
      success: true,
      code: plainCode,
      expires_at: expiresAt.toISOString(),
      label: label || 'Shared access',
      target_user_id: targetUserId || null,
    });
  } catch (error) {
    console.error('[Access Codes] Generate error:', error);
    res.status(500).json({ error: 'Failed to generate code' });
  }
});

// GET /api/access-codes — list codes (admin only)
router.get('/', async (req, res) => {
  try {
    const admin = await requireAdminSession(req);
    if (!admin) return res.status(401).json({ error: 'Admin access required' });

    const result = await pool.query(
      `SELECT ac.id, ac.label, ac.expires_at, ac.max_uses, ac.used_count, ac.is_active, ac.created_at,
              ac.target_user_id, u.username AS target_username
       FROM access_codes ac
       LEFT JOIN users u ON u.id = ac.target_user_id
       ORDER BY ac.created_at DESC`
    );

    res.json({ codes: result.rows });
  } catch (error) {
    console.error('[Access Codes] List error:', error);
    res.status(500).json({ error: 'Failed to list codes' });
  }
});

// DELETE /api/access-codes/:id — deactivate a code (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const admin = await requireAdminSession(req);
    if (!admin) return res.status(401).json({ error: 'Admin access required' });

    await pool.query('UPDATE access_codes SET is_active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[Access Codes] Delete error:', error);
    res.status(500).json({ error: 'Failed to deactivate code' });
  }
});

// GET /api/access-codes/users — list users for admin dropdown (admin only)
router.get('/users', async (req, res) => {
  try {
    const admin = await requireAdminSession(req);
    if (!admin) return res.status(401).json({ error: 'Admin access required' });

    const result = await pool.query(
      `SELECT id, username, display_name, role
       FROM users
       ORDER BY username ASC`
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('[Access Codes] List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

module.exports = router;
