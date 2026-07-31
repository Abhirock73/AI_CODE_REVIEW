const mongoose = require('mongoose');

const reviewHistorySchema = new mongoose.Schema({
  repositoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Repository',
    required: true
  },
  // User who triggered the review (optional, for multi-user support)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  workspaceId: {
    type: String,
    default: null
  },
  repositoryType: {
    type: String,
    enum: ['github', 'zip'],
    default: 'github'
  },
  commitHash: {
    type: String,
    required: true
  },
  reviewData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Detected primary language of the repository at review time
  language: {
    type: String,
    default: null
  },
  // Granular scores produced by the new pipeline aggregator
  qualityScore: {
    type: Number,
    default: null
  },
  securityScore: {
    type: Number,
    default: null
  },
  performanceScore: {
    type: Number,
    default: null
  },
  maintainabilityScore: {
    type: Number,
    default: null
  },
  complexityScore: {
    type: Number,
    default: null
  },
  // Normalized static-analysis output (ESLint / Ruff / Bandit / Semgrep …)
  analyzerResults: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('ReviewHistory', reviewHistorySchema);
