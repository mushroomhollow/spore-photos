const express = require('express');
const router = express.Router();
const { rateLimit } = require('../middleware/rateLimit');

// Credential endpoints are the only way in; throttle them per IP so online
// guessing is impractical. The access-code flow additionally blacklists an IP
// after three bad codes.
const credentialLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const {
  resolveIp,
  resolveDeviceId,
  getOrCreateIp,
  getOrCreateDevice,
  findSession,
  createSession,
  deleteSession,
  blacklistIp,
} = require('../middleware/whitelistCheck');
const {
  resolveClientToken,
  authorizeDeviceForLogin,
  issueToken,
} = require('../services/clientToken');

// Session cookie: httpOnly, Secure whenever the request itself is HTTPS.
function setSessionCookie(req, res, token) {
  res.cookie('device_token', token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: req.secure ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

const USER_FIELDS = 'id, username, display_name, role';

// Track failed code attempts in memory (per IP)
const failedCodeAttempts = new Map();

// ─── POST /api/auth/check ──────────────────────────────────────────
// Determine the auth status for this client.
//
// Authorisation comes from a server-issued client token, never from the IP:
//   1. a valid session cookie             → auto_login
//   2. an authorised client with history  → auto_login (fresh session)
//   3. an authorised client without one   → login_required (password form)
//   4. anything else                      → code_required (invite only)
router.post('/check', async (req, res) => {
  try {
    const deviceId = resolveDeviceId(req);
    const clientToken = resolveClientToken(req);

    // 1. Existing session
    const deviceToken = req.cookies.device_token;
    if (deviceToken) {
      const session = await findSession(deviceToken);
      if (session && session.user_id && Date.now() <= new Date(session.expire_date).getTime()) {
        const userResult = await pool.query(
          `SELECT ${USER_FIELDS} FROM users WHERE id = $1 AND is_active = true`,
          [session.user_id]
        );
        if (userResult.rows.length > 0) {
          return res.json({ status: 'auto_login', user: userResult.rows[0] });
        }
      }
    }

    // 2 + 3. Remembered client. An authorised device with no token yet (first
    // login after an install, or a device added by an older version) still gets
    // the password form — that login is what issues its token.
    const device = await authorizeDeviceForLogin(deviceId, clientToken);
    if (!device) {
      // Unknown client — this instance is invite-only.
      return res.json({ status: 'code_required' });
    }

    const recentSession = await pool.query(
      `SELECT user_id FROM sessions
        WHERE device_id = $1 AND user_id IS NOT NULL
        ORDER BY create_date DESC LIMIT 1`,
      [device.id]
    );
    // The auto-login shortcut needs the token the server issued; a device that
    // has merely been authorised still has to prove who it is with a password.
    if (device.tokenValid && recentSession.rows.length > 0) {
      const userResult = await pool.query(
        `SELECT ${USER_FIELDS} FROM users WHERE id = $1 AND is_active = true`,
        [recentSession.rows[0].user_id]
      );
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const ipRec = await getOrCreateIp(resolveIp(req));
        // One session per device: otherwise signing out would only clear the
        // newest session and the leftover ones would keep auto-logging in.
        await pool.query('DELETE FROM sessions WHERE device_id = $1', [device.id]);
        await createSession(sessionToken, device.id, ipRec.id, user.id, expiresAt);
        setSessionCookie(req, res, sessionToken);
        return res.json({ status: 'auto_login', user });
      }
    }

    return res.json({ status: 'login_required', deviceTrusted: true, ipTrusted: false });
  } catch (error) {
    console.error('[Auth Check] Error:', error);
    res.status(500).json({ error: 'Auth check failed' });
  }
});

// ─── POST /api/auth/login ──────────────────────────────────────────
// Standard login with username + password.
// On success: creates session, and if IP isn't whitelisted for this device, adds it.
router.post('/login', credentialLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = resolveIp(req);
    const deviceId = resolveDeviceId(req);
    const clientToken = resolveClientToken(req);

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Only an authorised client may attempt a password login. A brand-new
    // device must be added with an access code first (this instance is
    // invite-only), and an existing one must present its client token.
    const device = await authorizeDeviceForLogin(deviceId, clientToken);
    if (!device) {
      return res.status(403).json({
        error: 'This device is not authorised. Use an access code to add it.',
        code: 'device_not_authorised',
      });
    }

    const result = await pool.query(
      'SELECT id, username, display_name, password_hash, role, is_active FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      console.log(`[Auth] Login failed: unknown user ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account disabled' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      console.log(`[Auth] Login failed: bad password for ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const ipRec = await getOrCreateIp(ip);
    // One live session per device, so signing out really signs out.
    await pool.query('DELETE FROM sessions WHERE device_id = $1', [device.id]);
    await createSession(sessionToken, device.id, ipRec.id, user.id, expiresAt);

    // Remember this client: this token is the credential for auto-login later.
    const issuedToken = await issueToken(device.id);

    setSessionCookie(req, res, sessionToken);

    console.log(`[Auth] Login: ${username} from ${ip} (device: ${deviceId})`);
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
      client_token: issuedToken,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── POST /api/auth/check-code ────────────────────────────────────
// Validate a temporary access code. Tracks failed attempts per IP.
// 3 failures → IP gets blacklisted.
router.post('/check-code', credentialLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    const ip = resolveIp(req);

    if (!code) {
      return res.status(400).json({ error: 'Access code required' });
    }

    // Check blacklist (double-check)
    const blacklistResult = await pool.query(
      'SELECT id FROM ip_addresses WHERE ip = $1 AND blacklisted = true',
      [ip]
    );
    if (blacklistResult.rows.length > 0) {
      return res.status(403).send('Access Denied');
    }

    // Find matching code in DB
    const result = await pool.query(
      `SELECT id, code_hash, max_uses, used_count, expires_at, is_active, target_user_id
       FROM access_codes WHERE is_active = true`
    );

    let matchedCode = null;
    for (const row of result.rows) {
      if (await bcrypt.compare(code.toUpperCase(), row.code_hash)) {
        matchedCode = row;
        break;
      }
    }

    if (!matchedCode) {
      // Failed attempt — track it
      const attempts = (failedCodeAttempts.get(ip) || 0) + 1;
      failedCodeAttempts.set(ip, attempts);
      console.log(`[Auth Code] Failed attempt ${attempts}/3 from ${ip}`);

      if (attempts >= 3) {
        await blacklistIp(ip, '3 failed access code attempts');
        failedCodeAttempts.delete(ip);
        console.log(`[Auth Code] Blacklisted ${ip} — 3 failed attempts`);
        return res.status(403).send('Access Denied');
      }

      const remaining = 3 - attempts;
      return res.status(401).json({
        error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
        remaining,
      });
    }

    // Check expiry
    if (Date.now() > new Date(matchedCode.expires_at).getTime()) {
      await pool.query('UPDATE access_codes SET is_active = false WHERE id = $1', [matchedCode.id]);
      return res.status(401).json({ error: 'Code has expired' });
    }

    // Check max uses
    if (matchedCode.max_uses && matchedCode.used_count >= matchedCode.max_uses) {
      await pool.query('UPDATE access_codes SET is_active = false WHERE id = $1', [matchedCode.id]);
      return res.status(401).json({ error: 'Code has been used too many times' });
    }

    // Success — increment use count and issue a one-time registration token
    await pool.query('UPDATE access_codes SET used_count = used_count + 1 WHERE id = $1', [matchedCode.id]);
    failedCodeAttempts.delete(ip);

    const regToken = crypto.randomBytes(32).toString('hex');
    if (!global.regTokens) global.regTokens = new Map();

    if (matchedCode.target_user_id) {
      // ── Existing-user code: look up the user, return set-password flow ──
      const userResult = await pool.query(
        'SELECT id, username, display_name FROM users WHERE id = $1',
        [matchedCode.target_user_id]
      );
      if (userResult.rows.length === 0) {
        return res.status(400).json({ error: 'Target user no longer exists' });
      }
      const targetUser = userResult.rows[0];
      global.regTokens.set(regToken, {
        ip,
        expires: Date.now() + 15 * 60 * 1000,
        type: 'set_password',
        target_user_id: targetUser.id,
      });
      console.log(`[Auth Code] Existing-user code redeemed from ${ip}, target: ${targetUser.username}`);
      res.json({
        success: true,
        reg_token: regToken,
        type: 'set_password',
        target_username: targetUser.username,
        target_user_id: targetUser.id,
      });
    } else {
      // ── New-user code: return reg_token for account creation ──
      global.regTokens.set(regToken, {
        ip,
        expires: Date.now() + 15 * 60 * 1000,
        type: 'register',
      });
      console.log(`[Auth Code] Code redeemed from ${ip}`);
      res.json({
        success: true,
        reg_token: regToken,
      });
    }
  } catch (error) {
    console.error('[Auth Code] Error:', error);
    res.status(500).json({ error: 'Code validation failed' });
  }
});

// ─── POST /api/auth/register-from-code ─────────────────────────────
// Create a new user account after validating an access code.
router.post('/register-from-code', credentialLimiter, async (req, res) => {
  try {
    const { reg_token, username, password, display_name } = req.body;
    const ip = resolveIp(req);
    const deviceId = resolveDeviceId(req);

    if (!reg_token || !username || !password) {
      return res.status(400).json({ error: 'Registration token, username, and password required' });
    }

    // Validate registration token
    if (!global.regTokens || !global.regTokens.has(reg_token)) {
      return res.status(401).json({ error: 'Invalid or expired registration token' });
    }

    const regData = global.regTokens.get(reg_token);
    if (regData.ip !== ip || Date.now() > regData.expires) {
      global.regTokens.delete(reg_token);
      return res.status(401).json({ error: 'Registration token expired' });
    }

    // Clean up used token
    global.regTokens.delete(reg_token);

    // Validate username uniqueness
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      `INSERT INTO users (username, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'member')
       RETURNING id, username, display_name, role`,
      [username, display_name || username, passwordHash]
    );
    const user = userResult.rows[0];

    // The redeemed access code authorises this client.
    const devRec = deviceId ? await getOrCreateDevice(deviceId) : null;
    const issuedToken = devRec ? await issueToken(devRec.id) : null;

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const ipRec = await getOrCreateIp(ip);
    if (devRec) await pool.query('DELETE FROM sessions WHERE device_id = $1', [devRec.id]);
    await createSession(sessionToken, devRec?.id, ipRec.id, user.id, expiresAt);

    setSessionCookie(req, res, sessionToken);

    console.log(`[Auth] New user registered: ${username} from ${ip}`);
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
      client_token: issuedToken,
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/set-password-from-code ──────────────────────────
// Existing user sets a new password after redeeming an access code.
router.post('/set-password-from-code', credentialLimiter, async (req, res) => {
  try {
    const { reg_token, password } = req.body;
    const ip = resolveIp(req);
    const deviceId = resolveDeviceId(req);

    if (!reg_token || !password) {
      return res.status(400).json({ error: 'Registration token and password required' });
    }

    if (!global.regTokens || !global.regTokens.has(reg_token)) {
      return res.status(401).json({ error: 'Invalid or expired registration token' });
    }

    const regData = global.regTokens.get(reg_token);
    if (regData.type !== 'set_password') {
      global.regTokens.delete(reg_token);
      return res.status(400).json({ error: 'Invalid token type' });
    }

    if (regData.ip !== ip || Date.now() > regData.expires) {
      global.regTokens.delete(reg_token);
      return res.status(401).json({ error: 'Registration token expired' });
    }

    // Clean up used token
    global.regTokens.delete(reg_token);

    // Update password for the target user
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, regData.target_user_id]
    );

    // The redeemed code also authorises this client.
    const devRec = deviceId ? await getOrCreateDevice(deviceId) : null;
    const issuedToken = devRec ? await issueToken(devRec.id) : null;

    console.log(`[Auth] Password set via code for user: ${regData.target_user_id} from ${ip}`);
    res.json({ success: true, client_token: issuedToken });
  } catch (error) {
    console.error('[Auth] Set password error:', error);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const deviceToken = req.cookies.device_token;
    let userId = null;
    if (deviceToken) {
      const session = await findSession(deviceToken);
      if (session) {
        userId = session.user_id;
      }
      await deleteSession(deviceToken);
    }

    res.clearCookie('device_token');
    res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ─── POST /api/auth/me ─────────────────────────────────────────────
router.post('/me', async (req, res) => {
  try {
    const deviceToken = req.cookies.device_token;
    if (!deviceToken) {
      return res.status(401).json({ authenticated: false });
    }

    const session = await findSession(deviceToken);
    if (!session) {
      return res.status(401).json({ authenticated: false });
    }

    const now = Date.now();
    const expiresAt = new Date(session.expire_date).getTime();
    if (now > expiresAt) {
      await deleteSession(deviceToken);
      return res.status(401).json({ authenticated: false });
    }

    // Get fresh user data from DB
    const result = await pool.query(
      'SELECT id, username, display_name, role FROM users WHERE id = $1',
      [session.user_id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error('[Auth] Session error:', error);
    res.status(500).json({ error: 'Session check failed' });
  }
});

// ─── POST /api/auth/change-password ────────────────────────────────
router.post('/change-password', async (req, res) => {
  try {
    const deviceToken = req.cookies.device_token;
    if (!deviceToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = await findSession(deviceToken);
    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [session.user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, session.user_id]);

    console.log(`[Auth] Password changed for user: ${session.username}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Password change error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ─── GET /api/auth/preferences ───────────────────────────────────
router.get('/preferences', async (req, res) => {
  try {
    const deviceToken = req.cookies.device_token;
    if (!deviceToken) return res.status(401).json({ error: 'Not authenticated' });
    const session = await findSession(deviceToken);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    let result = await pool.query(
      'SELECT photo_grid_size FROM user_preferences WHERE user_id = $1',
      [session.user_id]
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        'INSERT INTO user_preferences (user_id) VALUES ($1) RETURNING photo_grid_size',
        [session.user_id]
      );
    }

    res.json({ preferences: result.rows[0] });
  } catch (error) {
    console.error('[Auth] Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// ─── PUT /api/auth/preferences ───────────────────────────────────
router.put('/preferences', async (req, res) => {
  try {
    const deviceToken = req.cookies.device_token;
    if (!deviceToken) return res.status(401).json({ error: 'Not authenticated' });
    const session = await findSession(deviceToken);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    const { photo_grid_size } = req.body;
    const valid = ['xs', 'sm', 'md', 'lg', 'xl'];
    if (!valid.includes(photo_grid_size)) {
      return res.status(400).json({ error: 'Invalid grid size' });
    }

    const result = await pool.query(
      `INSERT INTO user_preferences (user_id, photo_grid_size)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET photo_grid_size = $2, updated_at = NOW()
       RETURNING photo_grid_size`,
      [session.user_id, photo_grid_size]
    );

    res.json({ preferences: result.rows[0] });
  } catch (error) {
    console.error('[Auth] Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
