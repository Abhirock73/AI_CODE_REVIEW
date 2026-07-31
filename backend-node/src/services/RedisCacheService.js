const { getCache, setCache } = require('./redisCache');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class RedisCacheService {
  /**
   * Generates a deterministic cache key for a repository based on its current state.
   * @param {Object} repo - Mongoose Repository document
   * @returns {string|null} The generated cache key, or null if generation fails
   */
  static generateCacheKey(repo) {
    if (!repo || !repo.metadata || !repo.metadata.storagePath) {
      return null;
    }

    const isGithub = repo.metadata.isGithubImported;
    const cwd = repo.metadata.storagePath;

    if (isGithub) {
      try {
        const commitSha = execSync('git log -1 --format="%H"', { cwd, encoding: 'utf-8' }).trim();
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
        
        let ownerRepo = repo.name; 
        const urlMatch = repo.url.match(/github\.com\/([^/]+\/[^/.]+)/);
        if (urlMatch) {
          ownerRepo = urlMatch[1].replace(/\.git$/, '');
        }

        return `review:github:${ownerRepo}:${branch}:${commitSha}`;
      } catch (err) {
        console.error('[RedisCacheService] Failed to generate GitHub cache key:', err.message);
        return null;
      }
    } else {
      // ZIP Upload - generate hash of directory contents
      try {
        const hash = crypto.createHash('sha256');
        
        const hashDirectory = (dir) => {
          if (!fs.existsSync(dir)) return;
          const files = fs.readdirSync(dir).sort();
          for (const file of files) {
            if (file === 'node_modules' || file === '.git' || file === '.DS_Store') continue;
            
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              hashDirectory(fullPath);
            } else {
              // Hash relative path and file contents
              const relativePath = path.relative(repo.metadata.storagePath, fullPath);
              hash.update(relativePath);
              hash.update(fs.readFileSync(fullPath));
            }
          }
        };
        
        hashDirectory(cwd);
        const sha256 = hash.digest('hex');
        return `review:zip:${sha256}`;
      } catch (err) {
        console.error('[RedisCacheService] Failed to generate ZIP cache key:', err.message);
        return null;
      }
    }
  }

  /**
   * Retrieves a cached review if it exists.
   * @param {string} key - Cache key
   * @returns {Promise<Object|null>}
   */
  static async getCachedReview(key) {
    if (!key) return null;
    try {
      const data = await getCache(key);
      return data;
    } catch (e) {
      console.error('[RedisCacheService] Redis GET error:', e.message);
      return null; // Graceful degradation
    }
  }

  /**
   * Saves a full review object to Redis.
   * @param {string} key - Cache key
   * @param {Object} review - Complete ReviewHistory document/object
   */
  static async saveReviewToCache(key, review) {
    if (!key) return;
    try {
      // TTL = 24 Hours (86400 seconds)
      await setCache(key, review, 86400); 
    } catch (e) {
      console.error('[RedisCacheService] Redis SET error:', e.message);
    }
  }
}

module.exports = RedisCacheService;
