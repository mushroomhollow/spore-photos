const express = require('express');
const helmet = require('helmet');
const fs = require('fs-extra');
const config = require('./config');
const pool = require('./db/pool');
const shareRouter = require('./routes/share');
const { applyStoredPhotosRoot } = require('./settings');

const app = express();
const PORT = config.port;

// Trust proxy headers only when the deployment says a proxy sets them.
app.set('trust proxy', config.trustProxy);

// ── Middleware ──
app.use(helmet({
  contentSecurityPolicy: false, // share pages use inline styles
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // images come from the main app origin
}));
app.use(express.json({ limit: '50mb' }));

// ── Routes ──
app.use('/', shareRouter);

// ── Health ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'spore-photos-public-share',
    version: config.version,
    timestamp: new Date().toISOString(),
  });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
async function start() {
  // Honour the photos root configured in the main app (Settings > Storage), so
  // share links always read the same folder the gallery does.
  await applyStoredPhotosRoot();

  await fs.ensureDir(config.picturesRoot);

  console.log(`[Spore-Photos Public Share]`);
  console.log(`  Env:        ${config.env}`);
  console.log(`  Port:       ${PORT}`);
  console.log(`  Database:   ${config.db.database}`);
  console.log(`  Pictures:   ${config.picturesRoot}`);

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Public share server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`[Shutdown] ${signal} received, draining...`);
    server.close(async () => {
      try { await pool.end(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => {
  console.error('Failed to start public share server:', err);
  process.exit(1);
});

module.exports = app;
