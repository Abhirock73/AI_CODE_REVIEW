const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const fs = require('fs').promises;
const path = require('path');
const simpleGit = require('simple-git');
const authMiddleware = require('../middleware/auth');
const Repository = require('../models/Repository');
const User = require('../models/User');
const { decrypt } = require('../utils/cryptoUtils');
const { parseDirectory, calculateLanguageStats } = require('../utils/repoParser');
const { createRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const os = require('os');
const WORKSPACE_DIR = path.join(os.tmpdir(), 'tmp_workspace');

const WorkspaceManager = require('../services/WorkspaceManager');

// Setup multer for zip uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB limit
});

// Ensure workspace dir exists on startup
async function ensureWorkspaceDir() {
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
    console.log(`📁 [Workspace] Ensured directory exists: ${WORKSPACE_DIR}`);
  } catch (err) {
    console.error('Failed to create workspace directory', err);
  }
}
ensureWorkspaceDir();

/**
 * Helper to execute robust git clone with SSL/Buffer fixes & automatic fallback
 */
async function performGitClone(cloneUrl, clonePath) {
  const git = simpleGit();
  const optionsWithShallow = [
    '-c', 'http.postBuffer=524288000',
    '-c', 'http.version=HTTP/1.1',
    '--depth', '1',
  ];
  const optionsFull = [
    '-c', 'http.postBuffer=524288000',
    '-c', 'http.version=HTTP/1.1',
  ];

  try {
    await git.clone(cloneUrl, clonePath, optionsWithShallow);
  } catch (shallowErr) {
    console.warn(`[Git Clone] Shallow clone attempt failed (${shallowErr.message}). Retrying full clone...`);
    try {
      await fs.rm(clonePath, { recursive: true, force: true });
      await fs.mkdir(clonePath, { recursive: true });
    } catch (e) {
      // Ignore
    }
    await git.clone(cloneUrl, clonePath, optionsFull);
  }
}

// Upload ZIP endpoint
const zipLimiter = createRateLimiter({
  type: 'zip',
  limit: 10,
  windowSeconds: 3600, // 1 hour
  customMessage: 'Too many ZIP uploads. Please try again after 1 hour.'
});

router.post('/upload', authMiddleware, zipLimiter, upload.single('repoZip'), async (req, res) => {
  let repo = null;
  let workspace = null;
  try {
    // STEP 4 - VERIFY ZIP EXISTS
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      throw new Error('ZIP file is missing or empty.');
    }
    console.log(`ZIP file received. Original Name: ${req.file.originalname}, Size: ${(req.file.buffer.length / 1024 / 1024).toFixed(2)} MB`);

    const repoName = req.body.name || req.file.originalname.replace('.zip', '');
    
    // Create the Repository model first so we have an ID
    repo = new Repository({
      userId: req.userId,
      name: repoName,
      url: 'uploaded-zip'
    });
    
    // 1. Temporary workspace created
    workspace = await WorkspaceManager.createWorkspace(repo._id, 'zip', req.userId);
    const extractPath = workspace.repositoryPath;

    // 2. ZIP extracted
    console.log(`📂 Extracting repo "${repoName}" to: ${extractPath}`);
    const zip = await JSZip.loadAsync(req.file.buffer);
    await fs.mkdir(extractPath, { recursive: true });
    
    let extractedCount = 0;
    let extractedSize = 0;

    for (const relativePath of Object.keys(zip.files)) {
      const file = zip.files[relativePath];
      const filePath = path.join(extractPath, relativePath);
      
      if (file.dir) {
        await fs.mkdir(filePath, { recursive: true });
      } else {
        extractedCount++;
        if (extractedCount > 20000) {
          throw new Error('Repository limit exceeded: More than 20,000 files.');
        }

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const content = await file.async('nodebuffer');
        
        extractedSize += content.length;
        if (extractedSize > 500 * 1024 * 1024) {
          throw new Error('Repository limit exceeded: Extracted size is over 500MB.');
        }
        
        await fs.writeFile(filePath, content);
      }
    }

    // 3. Workspace available
    const tree = await parseDirectory(extractPath);
    const langStats = calculateLanguageStats(tree);

    // 4. MongoDB updated
    repo.metadata = {
      tree,
      languageStats: langStats,
      storagePath: extractPath
    };

    await repo.save();
    console.log(`✅ [ZIP Upload] Repo "${repoName}" saved. ID: ${repo._id}, Path: ${extractPath}`);

    // 5. Frontend success response
    res.status(201).json({ message: 'Repository uploaded and parsed successfully', repo });
  } catch (error) {
    console.error(`ZIP upload error: ${error.message}`);
    if (workspace && workspace.workspaceId) {
      await WorkspaceManager.deleteWorkspace(workspace.workspaceId).catch(() => {});
    }
    if (repo && repo._id) {
      await Repository.deleteOne({ _id: repo._id }).catch(() => {});
    }
    const statusCode = error.message && error.message.includes('limit exceeded') ? 400 : 500;
    res.status(statusCode).json({ message: error.message, error: error.message });
  }
});

// Import GitHub endpoint
router.post('/import-github', authMiddleware, async (req, res) => {
  let repo = null;
  let workspace = null;
  try {
    const { url } = req.body;
    if (!url || !url.startsWith('https://github.com/')) {
      return res.status(400).json({ message: 'Invalid GitHub URL' });
    }

    const repoName = url.split('/').pop().replace('.git', '');
    
    repo = new Repository({
      userId: req.userId,
      name: repoName,
      url: url
    });

    workspace = await WorkspaceManager.createWorkspace(repo._id, 'github', req.userId);
    const clonePath = workspace.repositoryPath;

    let cloneUrl = url;
    if (req.userId) {
      const user = await User.findById(req.userId);
      if (user && user.githubAccessToken) {
        const decryptedToken = decrypt(user.githubAccessToken);
        if (decryptedToken) {
          cloneUrl = url.replace('https://github.com/', `https://x-access-token:${decryptedToken}@github.com/`);
        }
      }
    }

    console.log(`📂 [GitHub Import] Cloning "${repoName}" to: ${clonePath}`);

    await fs.mkdir(clonePath, { recursive: true });
    await performGitClone(cloneUrl, clonePath);

    const tree = await parseDirectory(clonePath);
    const langStats = calculateLanguageStats(tree);

    repo.metadata = {
      tree,
      languageStats: langStats,
      storagePath: clonePath,
    };

    await repo.save();
    console.log(`✅ [GitHub Import] Repo "${repoName}" saved. ID: ${repo._id}, Path: ${clonePath}`);

    res.status(201).json({ message: 'GitHub repository imported successfully', repo });
  } catch (error) {
    console.error('GitHub import error:', error);
    if (workspace && workspace.workspaceId) {
      await WorkspaceManager.deleteWorkspace(workspace.workspaceId).catch(() => {});
    }
    if (repo && repo._id) {
      await Repository.deleteOne({ _id: repo._id }).catch(() => {});
    }
    const statusCode = error.message && error.message.includes('limit exceeded') ? 400 : 500;
    res.status(statusCode).json({ message: 'Failed to import GitHub repository', error: error.message });
  }
});

const StorageService = require('../services/StorageService');

// GET /api/repo/:id/download - Dynamic ZIP Download
router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const workspace = await WorkspaceManager.getWorkspace(req.params.id, req.userId, false);
    if (!workspace) {
      return res.status(404).json({ success: false, error: 'Workspace not found or expired' });
    }
    
    if (workspace.repositoryType === 'github') {
      return res.status(400).json({ success: false, error: 'Download is not supported for GitHub repositories' });
    }

    console.log(`[RepoRoute] Compressing workspace for download...`);
    const zipBuffer = await StorageService.zipProject(workspace.repositoryPath);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="repo-${workspace.repositoryId}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    console.error(`[RepoRoute] ZIP download error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to generate ZIP', details: error.message });
  }
});

// GET /api/repo/:id/workspace-status - Get workspace inactivity status
router.get('/:id/workspace-status', authMiddleware, async (req, res) => {
  try {
    const workspace = await WorkspaceManager.getWorkspace(req.params.id, req.userId, true); // readOnly: do NOT update lastActivity
    if (!workspace) {
      return res.json({
        workspaceId: null,
        createdAt: null,
        lastActivity: null,
        status: 'EXPIRED',
        dirty: false,
        repositoryType: null
      });
    }

    res.json({
      workspaceId: workspace.workspaceId,
      createdAt: workspace.createdAt,
      lastActivity: workspace.lastActivity,
      status: workspace.status,
      dirty: workspace.dirty,
      repositoryType: workspace.repositoryType
    });
  } catch (error) {
    console.error('Workspace status error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch workspace status', details: error.message });
  }
});

// DELETE /api/repo/:id/workspace - Discard/Delete workspace forcefully
router.delete('/:id/workspace', authMiddleware, async (req, res) => {
  try {
    const workspace = await WorkspaceManager.getWorkspace(req.params.id, req.userId);
    if (!workspace) {
      return res.status(404).json({ success: false, error: 'Workspace not found' });
    }
    await WorkspaceManager.deleteWorkspace(workspace.workspaceId);
    res.json({ success: true, message: 'Workspace deleted successfully' });
  } catch (error) {
    console.error('Workspace deletion error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete workspace', details: error.message });
  }
});


// POST /api/repo/:id/workspace/close - Graceful Workspace Close
router.post('/:id/workspace/close', authMiddleware, async (req, res) => {
  try {
    const workspace = await WorkspaceManager.getWorkspace(req.params.id, req.userId, false);
    if (!workspace) {
      return res.json({ success: true, message: 'Workspace already closed' });
    }


    await WorkspaceManager.deleteWorkspace(workspace.workspaceId);
    res.json({ success: true, message: 'Workspace closed successfully' });
  } catch (error) {
    console.error('Workspace close error:', error);
    res.status(500).json({ success: false, error: 'Failed to close workspace', details: error.message });
  }
});

// POST /api/repo/:id/workspace/ping - Keep alive
router.post('/:id/workspace/ping', authMiddleware, async (req, res) => {
  try {
    const workspace = await WorkspaceManager.getWorkspace(req.params.id, req.userId, false);
    if (!workspace) return res.status(404).json({ success: false });
    await WorkspaceManager.updateLastActivity(workspace.workspaceId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
