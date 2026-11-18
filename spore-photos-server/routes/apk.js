const express = require('express');
const router = express.Router();

const apkBuild = require('../services/apkBuild');
const { findSession } = require('../middleware/whitelistCheck');

async function requireSession(req, res) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const session = await findSession(deviceToken);
  if (!session) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return session;
}

async function requireAdmin(req, res) {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (session.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return null; }
  return session;
}

/**
 * What a non-admin needs from this endpoint is "is there an APK I can install,
 * and where". Toolchain paths, the keystore location and its fingerprint are
 * about the server's own filesystem, so they are admin-only.
 */
function publicView(status) {
  return {
    available: status.available,
    building: status.building,
    latest: status.available[0] || null,
  };
}

// ─── GET /api/apk/status ───────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const status = await apkBuild.status();
    if (session.role !== 'admin') return res.json(publicView(status));

    res.json({
      ...status,
      latest: status.available[0] || null,
      docs: 'docs/BUILD-APK.md',
    });
  } catch (error) {
    console.error('[APK] Status error:', error);
    res.status(500).json({ error: 'Failed to read the build status' });
  }
});

// ─── POST /api/apk/keystore ────────────────────────────────────────
// Create the signing key, once. The passphrase is used for this one call and
// never stored: the operator supplies it again when they build.
router.post('/keystore', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const passphrase = String(req.body?.passphrase || '');
    if (passphrase.length < 6) {
      return res.status(400).json({
        error: 'Choose a passphrase of at least 6 characters.',
        code: 'passphrase_too_short',
      });
    }

    const result = await apkBuild.initKeystore(passphrase, { alias: req.body?.alias });
    if (!result.ok) {
      const messages = {
        keystore_exists: 'This server already has a signing key. Replacing it would stop every app you have already installed from updating, so it is never replaced automatically — delete the file deliberately if that is what you want.',
        build_script_missing: 'The build script is not present in this installation (a container image built from the Dockerfile does not include the Android project). See docs/BUILD-APK.md for the container path.',
        keystore_failed: 'Could not create the key.',
      };
      return res.status(result.error === 'keystore_exists' ? 409 : 500).json({
        error: messages[result.error] || messages.keystore_failed,
        code: result.error,
        detail: result.detail,
      });
    }

    res.json({ success: true, fingerprint: result.fingerprint });
  } catch (error) {
    console.error('[APK] Keystore error:', error);
    res.status(500).json({ error: 'Failed to create the signing key' });
  }
});

// ─── POST /api/apk/build ───────────────────────────────────────────
// Start a build. Returns as soon as it is running; the panel follows the log.
router.post('/build', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const passphrase = String(req.body?.passphrase || '');
    const result = await apkBuild.startBuild(passphrase, { version: req.body?.version });

    if (!result.ok) {
      const messages = {
        no_toolchain: 'This machine is missing the Android build toolchain.',
        no_keystore: 'This server has no signing key yet. Create one first.',
        build_in_progress: 'A build is already running.',
        build_script_missing: 'The build script is not present in this installation.',
        version_mismatch: `This installation is version ${result.expected}; a build can only be made for that version.`,
        passphrase_required: 'The keystore passphrase is required to sign the build.',
        toolchain_unknown: 'Could not determine whether this machine can build. See docs/BUILD-APK.md.',
      };
      const code = result.error === 'build_in_progress' ? 409 : 400;
      return res.status(code).json({
        error: messages[result.error] || 'Could not start the build.',
        code: result.error,
        hints: result.hints || undefined,
        expected: result.expected,
      });
    }

    res.json({ success: true, started: true, version: result.version, apkName: result.apkName });
  } catch (error) {
    console.error('[APK] Build error:', error);
    res.status(500).json({ error: 'Failed to start the build' });
  }
});

// ─── GET /api/apk/build/status ─────────────────────────────────────
// The tail of the log plus the last result, so the panel can show progress
// without holding a connection open.
router.get('/build/status', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const status = await apkBuild.status();
    res.json({
      building: status.building,
      log: await apkBuild.logTail(),
      lastBuild: status.lastBuild,
      available: status.available,
    });
  } catch (error) {
    console.error('[APK] Build status error:', error);
    res.status(500).json({ error: 'Failed to read the build log' });
  }
});

module.exports = router;
