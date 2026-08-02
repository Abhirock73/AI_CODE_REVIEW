const Workspace = require('../models/Workspace');
const { getCache, expireCache } = require('../services/redisCache');

/**
 * Middleware to verify workspace ownership using Redis.
 * Must be placed AFTER authMiddleware.
 */
const workspaceAuth = async (req, res, next) => {
  try {
    // 1. Authenticate the user (handled by authMiddleware preceding this)
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication required for workspace' });
    }

    // 2. Extract repositoryId/workspaceId
    // Most routes use req.params.id as the repository ID, some might pass it in body
    const repositoryId = req.params.id || req.params.repositoryId || req.body.repositoryId || req.query.repositoryId || req.body.repoId || req.query.repoId;

    if (!repositoryId) {
      return res.status(400).json({ message: 'Repository ID is required to access workspace' });
    }

    // Find the workspace ID for this repository and user
    const workspace = await Workspace.findOne({ repositoryId, ownerId: req.userId }).sort({ createdAt: -1 });
    
    if (!workspace) {
      return res.status(404).json({ message: 'Workspace not found or unauthorized' });
    }

    const workspaceId = workspace.workspaceId;

    // 3. Read workspace:<workspaceId> from Redis
    const redisKey = `workspace:${workspaceId}`;
    const redisData = await getCache(redisKey);

    // 4. If key does not exist return 404
    if (!redisData) {
      return res.status(404).json({ message: 'Workspace session expired or not found in cache' });
    }

    // 5. Compare ownerId with authenticated user
    if (redisData.ownerId !== req.userId.toString()) {
      // 6. If mismatch return 403
      return res.status(403).json({ message: 'Forbidden: You do not own this workspace' });
    }

    // 7. Only then continue
    
    // Refresh TTL back to 30 minutes due to activity
    await expireCache(redisKey, 1800);

    // Attach to request for downstream handlers
    req.workspaceId = workspaceId;
    req.workspacePath = `/tmp/workspaces/${workspaceId}`;

    next();
  } catch (err) {
    console.error('[workspaceAuth] Error:', err);
    return res.status(500).json({ message: 'Internal server error verifying workspace access' });
  }
};

module.exports = workspaceAuth;
