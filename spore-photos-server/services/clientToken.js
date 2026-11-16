const crypto = require('crypto');
const pool = require('../db/pool');

/**
 * Authorised-client tokens.
 *
 * The device id the browser sends (X-Device-ID) is only a stable label — it is
 * self-asserted and therefore cannot be an authorisation. The client token is
 * issued by the server on a successful authentication, stored hashed in
 * `devices`, and must be presented as X-Client-Token for the remember-me /
 * auto-login path. Revoking a device (clearing its token) invalidates it.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Issue (or rotate) a token for a device row and mark it authorised. */
async function issueToken(deviceRowId) {
  const token = newToken();
  await pool.query(
    `UPDATE devices
        SET client_token_hash = $1,
            authorized = true,
            authorized_at = COALESCE(authorized_at, NOW()),
            update_date = NOW()
      WHERE id = $2`,
    [hashToken(token), deviceRowId]
  );
  return token;
}

/**
 * Authorisation gate for credential endpoints.
 *
 * Returns the device row when the caller may attempt a password login, or null.
 * A device with no token yet is allowed only while it is already authorised
 * (grandfathered devices and the first setup) — that is how a device earns its
 * token without an access code.
 */
async function authorizeDeviceForLogin(deviceId, clientToken) {
  if (!deviceId) return null;
  const { rows } = await pool.query(
    'SELECT id, device_id, authorized, client_token_hash FROM devices WHERE device_id = $1',
    [deviceId]
  );
  const device = rows[0];
  if (!device || !device.authorized) return null;

  if (!device.client_token_hash) {
    // Pre-token device: the first login sets its token. It gets the password
    // form but never the auto-login shortcut.
    return { ...device, tokenValid: false };
  }
  if (!clientToken) return null;
  const matches = hashToken(clientToken) === device.client_token_hash;
  return matches ? { ...device, tokenValid: true } : null;
}

function resolveClientToken(req) {
  return req.headers['x-client-token'] || null;
}

module.exports = {
  issueToken,
  authorizeDeviceForLogin,
  resolveClientToken,
  hashToken,
};