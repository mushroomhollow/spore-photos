const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { findSession } = require('../middleware/whitelistCheck');

async function getAuthUser(req) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) return null;
  const session = await findSession(deviceToken);
  if (!session) return null;
  return session;
}

// Max storage per user: 100 GB (configurable)
const MAX_STORAGE_BYTES = 100 * 1024 * 1024 * 1024;

// ── GET /api/stats ────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return res.status(401).json({ error: 'Not authenticated' });

    const userId = auth.user_id;

    // Photo count + total storage used
    const photoStats = await pool.query(
      `SELECT COUNT(*)::int AS photo_count, COALESCE(SUM(file_size), 0)::bigint AS storage_bytes
       FROM photos WHERE user_id = $1`,
      [userId]
    );

    // Album count
    const albumStats = await pool.query(
      'SELECT COUNT(*)::int AS album_count FROM albums WHERE owner_id = $1',
      [userId]
    );

    res.json({
      photo_count: photoStats.rows[0].photo_count,
      album_count: albumStats.rows[0].album_count,
      storage_bytes: parseInt(photoStats.rows[0].storage_bytes, 10),
      storage_max_bytes: MAX_STORAGE_BYTES,
    });
  } catch (error) {
    console.error('[Stats] Error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
