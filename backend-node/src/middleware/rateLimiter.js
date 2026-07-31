const { getClient, isReady } = require('../services/redisCache');

/**
 * Creates a rate limiting middleware
 * @param {string} type - The endpoint identifier (e.g., 'login', 'register', 'review')
 * @param {number} limit - Maximum number of requests allowed in the window
 * @param {number} windowSeconds - The time window in seconds
 * @param {string} customMessage - Optional custom error message
 */
const createRateLimiter = ({ type, limit, windowSeconds, customMessage }) => {
  return async (req, res, next) => {
    // If Redis is not ready, bypass rate limiting
    if (!isReady()) {
      return next();
    }

    const client = getClient();
    if (!client) {
      return next();
    }

    try {
      // Determine the identifier: user ID if authenticated, else IP address
      // Some endpoints (like login/register) don't have req.userId, so it falls back to IP.
      const identifier = req.userId || req.ip;
      
      if (!identifier) {
        return next();
      }

      const key = `rate:${type}:${identifier}`;

      // Increment the counter for this key
      const current = await client.incr(key);

      // If it's the first request, set the TTL expiry
      if (current === 1) {
        await client.expire(key, windowSeconds);
      }

      // If the limit is exceeded
      if (current > limit) {
        // Fetch remaining TTL for Retry-After header and logging
        const ttl = await client.ttl(key);
        
        console.log(`[RateLimiter] Triggered - Endpoint: ${type}, Identifier: ${identifier}, Remaining TTL: ${ttl}s`);

        res.set('Retry-After', ttl > 0 ? ttl : windowSeconds);
        
        return res.status(429).json({
          success: false,
          message: customMessage || 'Too many requests. Please try again later.'
        });
      }

      // Within limit, proceed
      next();
    } catch (error) {
      // If Redis operation fails, log and bypass to prevent blocking requests
      console.error(`[RateLimiter] Error processing rate limit for ${type}:`, error);
      next();
    }
  };
};

module.exports = {
  createRateLimiter
};
