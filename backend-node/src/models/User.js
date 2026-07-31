const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  githubUserId: {
    type: String,
    default: null,
  },
  githubAccessToken: {
    type: String,
    default: null, // Stored encrypted via AES-256-CBC
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
