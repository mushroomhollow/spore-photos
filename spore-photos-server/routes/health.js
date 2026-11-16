const express = require('express');
const config = require('../config');
const router = express.Router();

// GET /api/health - health check + the running version, so a client can warn
// when the server and the web bundle are on different releases.
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'spore-photos-api',
    version: config.version,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
