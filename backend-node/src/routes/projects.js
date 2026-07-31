const express = require('express');
const path = require('path');
const StorageService = require('../services/StorageService');
const { analyzeFile } = require('../utils/staticAnalyzer');
const { delCache, setCache } = require('../services/redisCache');

const router = express.Router();

/**
 * Helper to handle errors cleanly with proper HTTP status codes.
 */
const handleError = (res, error, defaultMessage = 'Internal server error') => {
  if (error.message && (error.message.includes('Access denied') || error.message.includes('traversal'))) {
    return res.status(403).json({ error: error.message });
  }
  if (error.message && (error.message.includes('not found') || error.code === 'ENOENT')) {
    return res.status(404).json({ error: error.message });
  }
  res.status(500).json({ error: error.message || defaultMessage });
};

/**
 * Helper to validate path parameter against path traversal.
 */
const validatePath = (targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Path parameter is required and must be a string');
  }
  // Check for explicit parent directory traversal attempts
  const normalized = path.normalize(targetPath);
  if (normalized.startsWith('..') || targetPath.includes('../') || targetPath.includes('..\\')) {
    throw new Error('Access denied: Path traversal outside project root is prohibited');
  }
  return normalized;
};

// GET /projects/:id/tree - Fetch project file tree (ignoring node_modules)
router.get('/:id/tree', async (req, res) => {
  try {
    const project = await StorageService.getProject(req.params.id);
    res.json({
      id: req.params.id,
      tree: project.tree,
      languageStats: project.languageStats,
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch project file tree');
  }
});



// GET /projects/:id/file - Read file content
router.get('/:id/file', async (req, res) => {
  try {
    const relativePath = req.query.path || req.query.filePath;
    const safePath = validatePath(relativePath);

    const content = await StorageService.readFile(req.params.id, safePath);
    res.send(content);
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    handleError(res, error, 'Failed to read file');
  }
});

// PUT /projects/:id/file - Save modifications directly to project folder & re-run analysis
router.put('/:id/file', async (req, res) => {
  try {
    const relativePath = req.body.path || req.body.filePath;
    const content = req.body.content !== undefined ? req.body.content : req.body.newContent;

    const safePath = validatePath(relativePath);
    if (content === undefined || content === null) {
      return res.status(400).json({ error: 'Content parameter is required' });
    }

    // 1. Save modified content directly into project workspace folder
    const result = await StorageService.writeFile(req.params.id, safePath, content);

    // 2. Bust stale cache and re-run static analysis on latest file
    const cacheKey = `analysis:${req.params.id}:${safePath}`;
    await delCache(cacheKey);

    const extension = path.extname(safePath).toLowerCase();
    const analysis = await analyzeFile(result.absolutePath, extension);
    await setCache(cacheKey, analysis, 3600);

    res.json({ message: 'File saved and analyzed successfully', analysis, ...result });
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    handleError(res, error, 'Failed to save file');
  }
});

// POST /projects/:id/file - Create file in project folder
router.post('/:id/file', async (req, res) => {
  try {
    const relativePath = req.body.path || req.body.filePath;
    const content = req.body.content !== undefined ? req.body.content : '';

    const safePath = validatePath(relativePath);
    const result = await StorageService.createFile(req.params.id, safePath, content);

    // Invalidate project tree/analysis cache if needed
    const cacheKey = `analysis:${req.params.id}:${safePath}`;
    await delCache(cacheKey);

    res.status(201).json({ message: 'File created successfully', ...result });
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    handleError(res, error, 'Failed to create file');
  }
});

// POST /projects/:id/folder - Create folder in project workspace
router.post('/:id/folder', async (req, res) => {
  try {
    const relativePath = req.body.path || req.body.folderPath;
    const safePath = validatePath(relativePath);

    const result = await StorageService.createFolder(req.params.id, safePath);
    res.status(201).json({ message: 'Folder created successfully', ...result });
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    handleError(res, error, 'Failed to create folder');
  }
});

// DELETE /projects/:id/file - Delete file/folder from project workspace
router.delete('/:id/file', async (req, res) => {
  try {
    const relativePath = req.query.path || req.body.path || req.query.filePath || req.body.filePath;
    const safePath = validatePath(relativePath);

    const result = await StorageService.deleteFile(req.params.id, safePath);

    // Invalidate cache
    const cacheKey = `analysis:${req.params.id}:${safePath}`;
    await delCache(cacheKey);

    res.json({ message: 'Deleted successfully', ...result });
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    handleError(res, error, 'Failed to delete file/folder');
  }
});

// PATCH /projects/:id/rename - Rename/move file or folder
router.patch('/:id/rename', async (req, res) => {
  try {
    const oldPath = req.body.oldPath;
    const newPath = req.body.newPath;

    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Both oldPath and newPath parameters are required' });
    }

    const safeOldPath = validatePath(oldPath);
    const safeNewPath = validatePath(newPath);

    const result = await StorageService.rename(req.params.id, safeOldPath, safeNewPath);

    // Bust cache for old path
    await delCache(`analysis:${req.params.id}:${safeOldPath}`);

    res.json({ message: 'Renamed successfully', ...result });
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    handleError(res, error, 'Failed to rename file/folder');
  }
});

module.exports = router;
