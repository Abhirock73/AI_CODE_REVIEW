const express = require('express');
const path = require('path');
const authMiddleware = require('../middleware/auth');
const workspaceAuth = require('../middleware/workspaceAuth');
const Repository = require('../models/Repository');
const WorkspaceManager = require('../services/WorkspaceManager');
const { analyzeFile } = require('../utils/staticAnalyzer');
const { getCache, setCache, delCache } = require('../services/redisCache');
const StorageService = require('../services/StorageService');

const router = express.Router();

// Get project details, file tree, and language stats
router.get('/:id/project', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });
    
    await WorkspaceManager.getWorkspace(req.params.id, req.userId);

    const projectData = await StorageService.getProject(req.params.id);
    res.json(projectData);
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ message: 'Failed to fetch project details', error: error.message });
  }
});

// Get raw file content using StorageService
router.get('/:id/file', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    await WorkspaceManager.getWorkspace(req.params.id, req.userId);

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ message: 'File path is required' });

    const content = await StorageService.readFile(req.params.id, filePath);
    res.send(content);
  } catch (error) {
    console.error('File fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch file', error: error.message });
  }
});

// Get file analysis
router.get('/:id/file/analysis', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    await WorkspaceManager.getWorkspace(req.params.id, req.userId);

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ message: 'File path is required' });

    const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.join(repo.metadata.storagePath, safePath);
    const extension = path.extname(safePath).toLowerCase();

    // Check Redis Cache
    const cacheKey = `analysis:${req.params.id}:${safePath}`;
    const cachedAnalysis = await getCache(cacheKey);
    if (cachedAnalysis) {
      return res.json(cachedAnalysis);
    }

    // Run Analysis
    const analysis = await analyzeFile(absolutePath, extension);
    
    // Save to Cache (expire in 1 hour)
    await setCache(cacheKey, analysis, 3600);

    res.json(analysis);
  } catch (error) {
    console.error('File analysis error:', error);
    res.status(500).json({ message: 'Failed to analyze file' });
  }
});

// Update file content, bust cache, re-run analysis, optionally persist AI score
router.put('/:id/file', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const workspace = await WorkspaceManager.getWorkspace(req.params.id, req.userId);
    if (workspace) {
      await WorkspaceManager.updateLastActivity(workspace.workspaceId, true); // mark dirty
    }

    const { filePath, newContent, aiScore } = req.body;
    if (!filePath) return res.status(400).json({ message: 'filePath is required' });
    if (newContent === undefined || newContent === null) return res.status(400).json({ message: 'newContent is required' });

    // 1. Write edited content using StorageService
    await StorageService.writeFile(req.params.id, filePath, newContent);
    console.log(`✏️  [File PUT] Saved "${filePath}" for repo "${repo.name}"`);

    const safePath = path.normalize(filePath).replace(/^(\.\.([/\\]|$))+/, '');
    const absolutePath = path.join(repo.metadata.storagePath, safePath);
    const extension = path.extname(safePath).toLowerCase();

    // 2. Bust stale analysis cache
    const cacheKey = `analysis:${req.params.id}:${safePath}`;
    await delCache(cacheKey);

    // 3. Re-run static analysis on the freshly saved file
    const analysis = await analyzeFile(absolutePath, extension);

    // 4. Cache the fresh analysis result
    await setCache(cacheKey, analysis, 3600);

    // 5. Persist AI quality score to Repository if supplied
    if (typeof aiScore === 'number') {
      await Repository.findByIdAndUpdate(req.params.id, { qualityScore: aiScore });
      console.log(`💯 [File PUT] Persisted qualityScore=${aiScore} for repo "${repo.name}"`);
    }

    res.json({ success: true, analysis });
  } catch (error) {
    console.error('File PUT error:', error);
    res.status(500).json({ message: 'Failed to save file', error: error.message });
  }
});

// Create new file
router.post('/:id/file', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ message: 'filePath is required' });

    const result = await StorageService.createFile(req.params.id, filePath, content || '');
    res.status(201).json(result);
  } catch (error) {
    console.error('Create file error:', error);
    res.status(500).json({ message: 'Failed to create file', error: error.message });
  }
});

// Create new folder
router.post('/:id/folder', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ message: 'folderPath is required' });

    const result = await StorageService.createFolder(req.params.id, folderPath);
    res.status(201).json(result);
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ message: 'Failed to create folder', error: error.message });
  }
});

// Delete file or folder
router.delete('/:id/file', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ message: 'File path is required' });

    const result = await StorageService.deleteFile(req.params.id, filePath);
    res.json(result);
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Failed to delete file', error: error.message });
  }
});

// Rename file or folder
router.post('/:id/rename', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ message: 'oldPath and newPath are required' });

    const result = await StorageService.rename(req.params.id, oldPath, newPath);
    res.json(result);
  } catch (error) {
    console.error('Rename error:', error);
    res.status(500).json({ message: 'Failed to rename file/folder', error: error.message });
  }
});

// Download project ZIP archive
router.get('/:id/zip', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const zipBuffer = await StorageService.zipProject(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${repo.name || 'project'}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    console.error('Zip project error:', error);
    res.status(500).json({ message: 'Failed to zip project', error: error.message });
  }
});

module.exports = router;
