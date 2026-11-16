const pool = require('../db/pool');
const config = require('../config');

const blacklistCheck = async (req, res, next) => {
  try {
    const cleanIp = resolveIp(req);
    req.clientIp = cleanIp;

    const result = await pool.query(
      'SELECT id FROM ip_addresses WHERE ip = $1 AND blacklisted = true',
      [cleanIp]
    );
    if (result.rows.length > 0) {
      console.log(`[Blacklist] Blocked: ${cleanIp}`);
      return res.status(403).send('Access Denied');
    }

    next();
  } catch (error) {
    console.error('[Blacklist] Error:', error);
    next();
  }
};

/**
 * Client IP, used only for blacklisting and for the admin's view of who
 * connected. It is never an authorisation factor — see services/clientToken.js.
 *
 * Forwarded headers are only honoured when the deployment declares a trusted
 * proxy (TRUST_PROXY=true). Otherwise a client can send its own
 * X-Forwarded-For / CF-Connecting-IP and either dodge an IP blacklist or
 * impersonate a whitelisted address.
 */
function resolveIp(req) {
  if (config.trustProxy) {
    const forwarded =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for'];
    if (forwarded) {
      return String(forwarded).split(',')[0].replace('::ffff:', '').trim();
    }
  }
  return (req.connection?.remoteAddress || req.ip || '').replace('::ffff:', '').trim();
}

function resolveDeviceId(req) {
  return req.headers['x-device-id'] || null;
}

async function getOrCreateIp(ip) {
  const result = await pool.query(
    `INSERT INTO ip_addresses (ip) VALUES ($1)
     ON CONFLICT (ip) DO UPDATE SET update_date = NOW()
     RETURNING id, whitelisted, blacklisted`,
    [ip]
  );
  return result.rows[0];
}

async function getOrCreateDevice(deviceId) {
  const result = await pool.query(
    `INSERT INTO devices (device_id) VALUES ($1)
     ON CONFLICT (device_id) DO UPDATE SET update_date = NOW()
     RETURNING id`,
    [deviceId]
  );
  return result.rows[0];
}

async function blacklistIp(ip, reason) {
  await pool.query(
    `UPDATE ip_addresses SET whitelisted = false, blacklisted = true, notes = $1, update_date = NOW()
     WHERE ip = $2`,
    [reason || 'Manual block', ip]
  );
}

async function findSession(token) {
  const result = await pool.query(
    `SELECT s.id, s.token, s.ip_address_id, s.device_id, s.user_id,
            s.create_date, s.expire_date,
            u.username, u.display_name, u.role
     FROM sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expire_date > NOW()`,
    [token]
  );
  return result.rows[0] || null;
}

async function createSession(token, deviceId, ipAddressId, userId, expireDate) {
  await pool.query(
    `INSERT INTO sessions (token, device_id, ip_address_id, user_id, expire_date)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, deviceId || null, ipAddressId || null, userId || null, expireDate]
  );
}

async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

module.exports = {
  blacklistCheck,
  resolveIp,
  resolveDeviceId,
  getOrCreateIp,
  getOrCreateDevice,
  blacklistIp,
  findSession,
  createSession,
  deleteSession,
};
