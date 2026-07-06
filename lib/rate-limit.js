// Lightweight in-memory sliding-window rate limiter for Express routes that
// trigger paid LLM API calls. No external dependency — single-process only,
// which is fine for this app's current single-instance Railway/local deploy.
//
// Every request to a route wrapped by rateLimit() costs real money (an
// Anthropic/OpenAI/Gemini call). /api/chatbot in particular has no
// authentication at all, so without a limiter here anyone on the internet
// could loop requests and run up an unbounded bill.

const buckets = new Map(); // key -> array of request timestamps (ms)

function keyFor(req) {
  // Prefer the client IP; Express only trusts X-Forwarded-For if `trust proxy`
  // is enabled upstream (e.g. behind Railway's edge), otherwise falls back to
  // the socket address.
  return req.ip || req.connection?.remoteAddress || "unknown";
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   Size of the sliding window in milliseconds.
 * @param {number} opts.max        Max requests allowed per key within the window.
 * @param {(req) => string} [opts.keyFn] Override the bucketing key (defaults to client IP).
 */
export function rateLimit({ windowMs, max, keyFn = keyFor }) {
  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    let hits = buckets.get(key);
    if (!hits) {
      hits = [];
      buckets.set(key, hits);
    }
    // Drop timestamps outside the current window.
    while (hits.length && hits[0] < windowStart) hits.shift();

    if (hits.length >= max) {
      const retryAfterMs = windowMs - (now - hits[0]);
      res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({
        error: "Too many requests — please slow down and try again shortly.",
      });
    }

    hits.push(now);
    next();
  };
}
