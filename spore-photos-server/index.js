const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const pool = require('./db/pool');

// Import middleware
const { blacklistCheck } = require('./middleware/whitelistCheck');

// Import routes
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const accessCodesRouter = require('./routes/accessCodes');
const usersRouter = require('./routes/users');
const photosRouter = require('./routes/photos');
const albumsRouter = require('./routes/albums');
const statsRouter = require('./routes/stats');
const shareRouter = require('./routes/share');
const settingsRouter = require('./routes/settings');
const versionRouter = require('./routes/version');
const apkRouter = require('./routes/apk');
const setupRouter = require('./routes/setup');
const { applyStoredPhotosRoot } = require('./services/settings');
const setup = require('./services/setup');

const app = express();
const PORT = config.port;

// Trust proxy headers only when the deployment says a proxy sets them. With
// TRUST_PROXY=false a client cannot forge X-Forwarded-For / CF-Connecting-IP
// and therefore cannot spoof its IP or pretend the connection is HTTPS.
app.set('trust proxy', config.trustProxy);

// --- Middleware ---
// Security headers. CSP is off because the bundled SPA and the public share
// views use inline styles; cross-origin resource policy is relaxed so the
// Android WebView (a different origin) can load photos.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = [
  config.corsOrigin,
  'capacitor://localhost',
  'https://localhost',
  'file://',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    // or from known Capacitor origins (Android WebView uses dynamic ports)
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.startsWith('https://localhost') ||
      origin.startsWith('capacitor://localhost') ||
      origin.startsWith('file://')
    ) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// --- Blacklist check runs on ALL /api/* routes ---
app.use('/api', blacklistCheck);

// --- CSRF guard for state-changing requests ---------------------------------
// A cross-site form cannot set custom headers, so requiring this one blocks
// classic CSRF even when the cookie is sent cross-site (SameSite=None behind a
// TLS proxy). The web client and the mobile app both send it; scripts must too.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use('/api', (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') return next();
  return res.status(403).json({
    error: 'Missing X-Requested-With: XMLHttpRequest header',
    code: 'csrf_header_required',
  });
});

// --- Routes ---
app.use('/api/health', healthRouter);
app.use('/api/setup', setupRouter);
app.use('/api/auth', authRouter);
app.use('/api/access-codes', accessCodesRouter);
app.use('/api/users', usersRouter);
app.use('/api/photos', photosRouter);
app.use('/api/albums', albumsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/version', versionRouter);
app.use('/api/apk', apkRouter);
app.use('/api', shareRouter);

const SHARE_SERVER_PORT = process.env.SHARE_SERVER_PORT || '3052';
// Separate containers (the Docker image runs the share service in its own
// container) need a hostname, not localhost.
const SHARE_SERVER_HOST = process.env.SHARE_SERVER_HOST || 'localhost';

// ── Proxy: forward /share/* and /api/share/* to the public share service ──
app.use((req, res, next) => {
  if (!req.url.startsWith('/share') && !req.url.startsWith('/api/share')) {
    return next();
  }

  const options = {
    hostname: SHARE_SERVER_HOST,
    port: SHARE_SERVER_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };

  // Remove hop-by-hop headers
  delete options.headers['connection'];
  delete options.headers['keep-alive'];
  delete options.headers['transfer-encoding'];

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[Proxy] Share server error:', err.message);
    res.status(502).json({ error: 'Share server unavailable' });
  });

  req.pipe(proxyReq);
});

// ── Serve the built web client (self-hosted deployments) ──
// In production nginx serves the SPA and only proxies /api here, so this stays
// dormant there. When someone runs this server directly — a laptop, or a home
// box reached over Tailscale — this makes one URL serve BOTH the app and the
// API, which is exactly what the mobile app's Settings → Server address needs.
const clientDist = path.resolve(__dirname, '..', 'spore-photos-client', 'dist');
const clientIndex = path.join(clientDist, 'index.html');
if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/share')) return next();
    res.sendFile(clientIndex);
  });
}

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start ---
async function start() {
  // Apply a stored photos_root override (Settings > Storage) before anything
  // reads config.picturesRoot. No override row => the PICTURES_ROOT env value
  // is used, exactly as before.
  try {
    await applyStoredPhotosRoot();
  } catch (e) {
    console.warn(`[Settings] Skipping photos_root override: ${e.message}`);
  }

  await fs.ensureDir(config.picturesRoot);

  console.log(`[Spore-Photos API] v${config.version}`);
  console.log(`  Env:        ${config.env}`);
  console.log(`  Port:       ${PORT}`);
  console.log(`  Database:   ${config.db.database}`);
  console.log(`  Pictures:   ${config.picturesRoot}`);
  console.log(`  TrustProxy: ${config.trustProxy}`);

  // First run: no accounts exist yet. Print the one-time setup token so the
  // person at the console can create the first admin in the web UI.
  try {
    const state = await setup.getState();
    if (state.needsSetup) {
      const token = await setup.getToken();
      console.log('');
      console.log('  ── First-run setup required ──');
      console.log(`  Open the site and enter this setup token: ${token}`);
      console.log('  (It is stored in app_settings and stays valid until setup completes.)');
      console.log('');
    }
  } catch (err) {
    console.warn(`  [Setup] Could not read setup state: ${err.message}`);
    console.warn('  [Setup] Run `npm run db:init` to create the schema.');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Container runtimes stop a process with SIGTERM. Finish in-flight uploads
  // and close the pool instead of being killed after the grace period.
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
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
