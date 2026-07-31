const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
  workspaceId: {
    type: String,
    required: true,
    unique: true
  },
  repositoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Repository',
    required: true
  },
  repositoryType: {
    type: String,
    enum: ['github', 'zip'],
    required: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  dirty: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'WARNING', 'CLEANING', 'INACTIVE'],
    default: 'ACTIVE'
  },
  repositoryPath: {
    type: String,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Workspace', workspaceSchema);
