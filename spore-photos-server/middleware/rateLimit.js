/**
 * Minimal fixed-window rate limiter.
 *
 * In-memory and per-process: enough to stop online password/code guessing on a
 * single-instance self-hosted server, with no extra dependency. If you run
 * several instances or want distributed limits, put a real limiter in the
 * reverse proxy as well.
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, message } = {}) {
  const hits = new Map();

  function prune(now) {
    if (hits.size < 5000) return;
    for (const [key, entry] of hits) {
      if (now > entry.reset) hits.delete(key);
    }
  }

  return (req, res, next) => {
    const key = req.clientIp || req.ip || 'unknown';
    const now = Date.now();
    prune(now);

    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({
        error: message || 'Too many attempts. Please wait and try again.',
      });
    }
    next();
  };
}

module.exports = { rateLimit };