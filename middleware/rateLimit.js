// Simple in-memory rate limiter.
//
// LIMITATIONS (documented):
// - Single-process only. Does not share state across multiple Render instances or
//   restarts. For production multi-instance deployments, replace the store with a
//   Redis-backed store (e.g. rate-limit-redis) and add the `express-rate-limit`
//   dependency + REDIS_URL configuration. This implementation is intended as a
//   baseline guard and for single-instance/dev usage.
// - Do not trust client-supplied IPs directly; rely on Express `trust proxy`
//   configuration (set in server.js) so req.ip reflects the Render proxy chain.

function createRateLimiter(options) {
  const {
    windowMs = 60 * 1000,
    max = 60,
    keyGenerator = (req) => req.ip || req.connection?.remoteAddress || 'unknown',
    message = 'Too many requests. Please try again later.',
  } = options || {};

  const store = new Map();

  // Periodic cleanup to avoid unbounded memory growth.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, windowMs);
  if (typeof cleanup.unref === 'function') cleanup.unref();

  return function rateLimitMiddleware(req, res, next) {
    if (process.env.NODE_ENV === 'test' || process.argv.includes('--test')) {
      return next();
    }
    const key = keyGenerator(req);
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ message, retryAfter });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
