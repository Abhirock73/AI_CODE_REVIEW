const express = require('express');
const authMiddleware = require('../middleware/auth');
const Repository = require('../models/Repository');
const ReviewHistory = require('../models/ReviewHistory');

const router = express.Router();

// GET /api/history - all repos for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const repos = await Repository.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('name url qualityScore metadata createdAt');

    const total = await Repository.countDocuments({ userId: req.userId });

    res.json({ repos, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch history' });
  }
});

// GET /api/history/:id - full repo with review history
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    const reviews = await ReviewHistory.find({ repositoryId: repo._id, commitHash: 'FULL_REPO_REVIEW' })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({ repo, reviews });
  } catch (error) {
    console.error('History detail fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch repository details' });
  }
});

module.exports = router;
