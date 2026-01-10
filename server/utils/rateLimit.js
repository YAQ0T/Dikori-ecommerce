// server/utils/rateLimit.js
// Simple in-memory rate limiter to throttle brute-force/spam endpoints

function defaultKeyGenerator(req) {
  return (req.ip || req.headers["x-forwarded-for"] || "").toString();
}

function createRateLimiter({
  windowMs = 60_000,
  max = 30,
  message = "تم تجاوز الحد المسموح. حاول لاحقًا.",
  keyGenerator = defaultKeyGenerator,
  name = "",
} = {}) {
  const buckets = new Map();

  return function rateLimiter(req, res, next) {
    try {
      const key = keyGenerator(req);
      if (!key) return next();

      const now = Date.now();
      const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

      if (bucket.resetAt <= now) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
      }

      bucket.count += 1;
      buckets.set(key, bucket);

      if (bucket.count > max) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000)
        );
        res.set("Retry-After", String(retryAfterSeconds));
        if (name) res.set("X-RateLimit-Name", name);
        return res
          .status(429)
          .json({ message, retryAfter: retryAfterSeconds });
      }

      return next();
    } catch (err) {
      console.error("rateLimiter error:", err);
      return res.status(500).json({ message: "خطأ في الخادم" });
    }
  };
}

function buildKeyedLimiter({ prefix = "", field }) {
  return createRateLimiter({
    keyGenerator: (req) => {
      const base = defaultKeyGenerator(req);
      const value = field ? req.body?.[field] || req.query?.[field] : "";
      return `${prefix}:${base}:${value || ""}`;
    },
  });
}

module.exports = {
  createRateLimiter,
  buildKeyedLimiter,
};
