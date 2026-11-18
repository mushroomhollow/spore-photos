const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const router = express.Router();

const config = require('../config');
const { CONFIG_PATH } = require('../../config/load');
const updateCheck = require('../services/updateCheck');
const installMethod = require('../lib/installMethod');
const { resolveUpdateSource } = require('../lib/resolveUpdateSource');
const { findSession } = require('../middleware/whitelistCheck');

// The environment variable that can supply the source instead of the config
// file. Named here so the UI can tell the operator both doors.
const SOURCE_ENV_VAR = 'UPDATE_SOURCE_URL';

async function requireSession(req, res) {
  const deviceToken = req.cookies.device_token;
  if (!deviceToken) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const session = await findSession(deviceToken);
  if (!session) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return session;
}

/**
 * The source URL, and where it came from.
 *
 * Read-only by design: the release source is an operator setting, configured in
 * the config file (or the environment), not something a web panel writes. The
 * UI's job is to say which of the two doors it came through and where the door
 * is, so the footnote can point at a real path instead of instructions.
 *
 * The precedence rule and the "skip an unusable value rather than fail" rule
 * live in lib/resolveUpdateSource.js, where they are unit-tested.
 */
function resolveSource() {
  const fromEnv = Boolean(String(process.env[SOURCE_ENV_VAR] || '').trim());
  const resolved = resolveUpdateSource({ configured: config.updateSourceUrl });

  return {
    ...resolved,
    // 'env' | 'file' | null — only meaningful when a source is actually set.
    from: resolved.origin === 'config' ? (fromEnv ? 'env' : 'file') : null,
  };
}

/**
 * The status payload, built in one place. `upgrade` is included only when there
 * is genuinely something to upgrade to, and it is derived from the check plus
 * how *this* install runs.
 */
function buildStatusPayload({ current, install, source, check }) {
  const payload = {
    current,
    install,
    source,
    check,
    // What this server calls itself, so the UI can name it instead of showing a
    // bare hostname. Empty = the UI falls back to the host it was served from.
    siteName: config.siteName || '',
    docs: installMethod.DOCS[install.method],
    // Where the source is configured, so the panel can name the file rather
    // than telling the operator to "see the config" — including the common case
    // where that file does not exist yet and the example has to be copied.
    configFile: CONFIG_PATH,
    configFileExists: fs.existsSync(CONFIG_PATH),
    configExample: 'config/spore-photos.config.example.json',
    sourceEnvVar: SOURCE_ENV_VAR,
  };

  if (check.ok && check.updateAvailable) {
    payload.upgrade = installMethod.upgradeSteps(install.method, {
      latest: check.latest,
      current,
      upgrade: check.upgrade || {},
    });
  }

  // How *this* install upgrades, whether or not anything is available. The
  // question "how would I update this?" is worth answering before an update
  // exists — otherwise the answer only appears at the moment it is needed, and
  // only for whoever happens to be looking at this panel.
  payload.installPath = installMethod.upgradeSteps(install.method, { current, upgrade: {} });

  return payload;
}

// ─── GET /api/version/status ───────────────────────────────────────
// On-demand update check: what this server runs, what the configured source
// says is available, and how this particular install upgrades.
//
// Any signed-in user may read it: the panel is informational, it contains no
// machinery, and hiding it would mean only admins ever learn an upgrade exists.
//
// Nothing here polls: the panel calls this when it opens, and the checker
// caches for five minutes and floor-limits forced checks to one a minute. With
// no source configured it issues no request at all.
router.get('/status', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const force = req.query.force === '1' || req.query.force === 'true';
    const source = resolveSource();
    const current = updateCheck.readCurrentVersion();
    const check = await updateCheck.getStatus({ force, source: source.url });
    const install = installMethod.detect();

    res.json(buildStatusPayload({ current, install, source, check }));
  } catch (error) {
    console.error('[Version] Status error:', error);
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

module.exports = router;
