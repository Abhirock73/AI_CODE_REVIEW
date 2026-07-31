'use strict';
/**
 * STEP 10 — Review Cache (SHA-256 per-file)
 * ─────────────────────────────────────────────────────────────────────────────
 * Before sending a file to the LLM:
 *   1. Compute SHA-256 hash of (fileContent + language)
 *   2. Check Redis key  "review:file:<hash>"
 *   3. HIT  → return cached result, skip LLM call
 *   4. MISS → caller runs LLM, then stores result via cacheResult()
 *
 * Cache TTL: 24 hours by default (configurable via REVIEW_CACHE_TTL_S env var).
 * If Redis is unavailable the cache gracefully degrades (no-ops).
 */

const crypto = require('crypto');
const { getCache, setCache } = require('../redisCache');

const TTL_SECONDS = parseInt(process.env.REVIEW_CACHE_TTL_S || '86400', 10); // 24 h

/**
 * Computes a stable SHA-256 hash for a file's content + language pair.
 *
 * @param {string} content
 * @param {string} language
 * @returns {string} hex string
 */
function hashFile(content, language) {
  return crypto
    .createHash('sha256')
    .update(`${language}::${content}`)
    .digest('hex');
}

/**
 * Redis key for a given hash.
 *
 * @param {string} hash
 * @returns {string}
 */
function cacheKey(hash) {
  return `review:file:${hash}`;
}

/**
 * Checks the cache for a previously computed review of this file content.
 *
 * @param {string} content
 * @param {string} language
 * @returns {Promise<Object|null>}  cached result or null if not found
 */
async function getCachedReview(content, language) {
  const hash = hashFile(content, language);
  const key  = cacheKey(hash);

  try {
    const cached = await getCache(key);
    if (cached) {
      console.log(`[ReviewCache] 🎯 Cache HIT  — hash ${hash.slice(0, 12)}…`);
      return cached;
    }
    console.log(`[ReviewCache] ❌ Cache MISS — hash ${hash.slice(0, 12)}…`);
    return null;
  } catch (err) {
    console.warn('[ReviewCache] Redis error on GET:', err.message);
    return null;
  }
}

/**
 * Stores a review result in Redis.
 *
 * @param {string} content
 * @param {string} language
 * @param {Object} result   – the LLM / aggregated result to cache
 */
async function cacheResult(content, language, result) {
  const hash = hashFile(content, language);
  const key  = cacheKey(hash);

  try {
    await setCache(key, result, TTL_SECONDS);
    console.log(`[ReviewCache] ✅ Cached     — hash ${hash.slice(0, 12)}… (TTL ${TTL_SECONDS}s)`);
  } catch (err) {
    console.warn('[ReviewCache] Redis error on SET:', err.message);
  }
}

/**
 * Computes the hash and returns it (useful for checking without reading cache).
 *
 * @param {string} content
 * @param {string} language
 * @returns {string}
 */
function computeHash(content, language) {
  return hashFile(content, language);
}

module.exports = { getCachedReview, cacheResult, computeHash };
