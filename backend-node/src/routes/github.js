const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const simpleGit = require('simple-git');
const User = require('../models/User');
const Repository = require('../models/Repository');
const { encrypt, decrypt } = require('../utils/cryptoUtils');
const { parseDirectory, calculateLanguageStats } = require('../utils/repoParser');
const authMiddleware = require('../middleware/auth');
const workspaceAuth = require('../middleware/workspaceAuth');
const WorkspaceManager = require('../services/WorkspaceManager');
const { createRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
router.use(authMiddleware);

const os = require('os');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(os.tmpdir(), 'tmp_workspace');

/**
 * Ensure workspace directory exists
 */
async function ensureWorkspaceDir() {
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  } catch (err) {
    // Ignore
  }
}
ensureWorkspaceDir();

/**
 * Helper to execute robust git clone with SSL/Buffer fixes & automatic fallback
 */
async function performGitClone(cloneUrl, clonePath) {
  const git = simpleGit().env({ GIT_TERMINAL_PROMPT: '0' });
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
      // Ignore cleanup error
    }
    await git.clone(cloneUrl, clonePath, optionsFull);
  }
}

/**
 * Helper to identify userId from auth header, query, or body
 */
const getUserIdFromReq = (req) => {
  if (req.userId) return req.userId;
  if (req.body && req.body.userId) return req.body.userId;
  if (req.query && req.query.userId) return req.query.userId;
  return null;
};

/**
 * Helper to resolve target storage path from request parameters
 */
const resolveStoragePath = async (req) => {
  const { storagePath, repoId, projectId } = req.body;
  const targetId = repoId || projectId || (req.query ? req.query.repoId || req.query.projectId : null);
  const targetPath = storagePath || (req.query ? req.query.storagePath : null);

  if (targetId) {
    try {
      const userId = getUserIdFromReq(req);
      if (userId) {
        await WorkspaceManager.getWorkspace(targetId, userId);
      }
      
      const repo = await Repository.findById(targetId);
      if (repo && repo.metadata && repo.metadata.storagePath) {
        return repo.metadata.storagePath;
      }
    } catch (e) {
      // Fallback to checking workspace dir if ID is a folder name
    }
    const fallbackPath = path.join(WORKSPACE_DIR, targetId);
    const exists = await fs.stat(fallbackPath).then(s => s.isDirectory()).catch(() => false);
    if (exists) return fallbackPath;
  }

  if (targetPath) {
    return targetPath;
  }

  return null;
};

/**
 * Helper to execute push with pre-push remote check
 */
const executePush = async (req, git, targetPath) => {
  const targetUserId = getUserIdFromReq(req);

  // Configure authenticated remote URL if user token is available
  if (targetUserId) {
    try {
      const user = await User.findById(targetUserId);
      if (user && user.githubAccessToken) {
        const decryptedToken = decrypt(user.githubAccessToken);
        if (decryptedToken) {
          const remotes = await git.getRemotes(true);
          const originRemote = remotes.find(r => r.name === 'origin');
          if (originRemote && originRemote.refs.push && originRemote.refs.push.startsWith('https://github.com/')) {
            const authPushUrl = originRemote.refs.push.replace('https://github.com/', `https://${decryptedToken}@github.com/`);
            await git.remote(['set-url', 'origin', authPushUrl]);
          }
        }
      }
    } catch (err) {
      console.warn('Could not set authenticated git remote URL:', err.message);
    }
  }

  // 1. git fetch
  try {
    await git.fetch();
  } catch (fetchErr) {
    console.warn('Git fetch notice:', fetchErr.message);
  }

  // 2. Verify local branch is not behind remote
  const status = await git.status();
  if (status.behind > 0) {
    return {
      success: false,
      error: 'Repository changed on GitHub. Pull latest changes before pushing.',
      status,
    };
  }

  // 3. git push
  const pushResult = await git.push();
  return {
    success: true,
    message: 'Pushed changes to remote repository successfully',
    pushResult,
  };
};

// POST /github/connect - Store encrypted githubAccessToken and githubUserId
router.post('/connect', async (req, res) => {
  try {
    const { code, accessToken, githubUserId } = req.body;
    const targetUserId = getUserIdFromReq(req);

    let finalAccessToken = accessToken;
    let finalGithubUserId = githubUserId;

    if (code && !finalAccessToken) {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(400).json({ message: 'GitHub OAuth Client ID & Secret not configured' });
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return res.status(400).json({ message: 'Failed to exchange GitHub OAuth code', details: tokenData });
      }
      finalAccessToken = tokenData.access_token;
    }

    if (finalAccessToken && !finalGithubUserId) {
      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${finalAccessToken}`,
            'User-Agent': 'AI-Code-Review-App',
          },
        });
        const userData = await userRes.json();
        if (userData && userData.id) {
          finalGithubUserId = String(userData.id);
        }
      } catch (e) {
        console.warn('Could not fetch GitHub user profile during connect:', e.message);
      }
    }

    if (!finalAccessToken) {
      return res.status(400).json({ message: 'accessToken or valid OAuth code is required' });
    }

    const encryptedToken = encrypt(finalAccessToken);

    if (targetUserId) {
      await User.findByIdAndUpdate(targetUserId, {
        githubUserId: finalGithubUserId || 'github-user',
        githubAccessToken: encryptedToken,
      });
    }

    res.json({
      success: true,
      message: 'GitHub connected successfully',
      githubUserId: finalGithubUserId || 'github-user',
    });
  } catch (error) {
    console.error('GitHub connect error:', error);
    res.status(500).json({ message: 'Failed to connect GitHub account', error: error.message });
  }
});

// POST /github/import - Clone repository into workspace, preserving .git folder
const githubImportLimiter = createRateLimiter({
  type: 'github',
  limit: 20,
  windowSeconds: 3600, // 1 hour
  customMessage: 'Too many GitHub imports. Please try again after 1 hour.'
});

router.post('/import', githubImportLimiter, async (req, res) => {
  try {
    const { url, repoUrl, name } = req.body;
    const targetUrl = url || repoUrl;
    const targetUserId = getUserIdFromReq(req);

    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).json({ message: 'Valid repository URL is required' });
    }

    const repoName = name || targetUrl.split('/').pop().replace(/\.git$/, '') || 'imported-repo';
    const clonePath = path.join(WORKSPACE_DIR, `${Date.now()}-${repoName}`);

    let cloneUrl = targetUrl;
    if (targetUrl.startsWith('https://github.com/')) {
      let formattedUrl = targetUrl;
      if (!formattedUrl.endsWith('.git')) {
        formattedUrl = `${formattedUrl}.git`;
      }
      cloneUrl = formattedUrl;

      if (targetUserId) {
        const user = await User.findById(targetUserId);
        if (user && user.githubAccessToken) {
          const decryptedToken = decrypt(user.githubAccessToken);
          if (decryptedToken) {
            cloneUrl = formattedUrl.replace('https://github.com/', `https://x-access-token:${decryptedToken}@github.com/`);
          }
        }
      }
    }

    console.log(`📂 [GitHub Import] Cloning "${repoName}" into workspace: ${clonePath}`);
    await fs.mkdir(clonePath, { recursive: true });

    await performGitClone(cloneUrl, clonePath);

    const gitFolderPath = path.join(clonePath, '.git');
    const hasGitFolder = await fs.stat(gitFolderPath).then(s => s.isDirectory()).catch(() => false);

    const tree = await parseDirectory(clonePath);
    const langStats = calculateLanguageStats(tree);

    let repo = null;
    if (targetUserId) {
      repo = new Repository({
        userId: targetUserId,
        name: repoName,
        url: targetUrl,
        metadata: {
          tree,
          languageStats: langStats,
          storagePath: clonePath,
          isGithubImported: true,
          hasGitFolder,
        },
      });
      await repo.save();
    }

    res.status(201).json({
      success: true,
      message: 'GitHub repository imported successfully',
      storagePath: clonePath,
      repoName,
      hasGitFolder,
      tree,
      languageStats: langStats,
      repo,
    });
  } catch (error) {
    console.error('GitHub import error:', error);
    res.status(500).json({ message: 'Failed to import GitHub repository', error: error.message });
  }
});

// GET /github/user - Fetch authenticated user's GitHub profile
router.get('/user', async (req, res) => {
  try {
    const targetUserId = getUserIdFromReq(req);
    if (!targetUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await User.findById(targetUserId);
    if (!user || !user.githubAccessToken) {
      return res.status(401).json({ message: 'GitHub account not connected for user' });
    }

    const decryptedToken = decrypt(user.githubAccessToken);
    if (!decryptedToken) {
      return res.status(401).json({ message: 'Failed to decrypt stored GitHub access token' });
    }

    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${decryptedToken}`,
        'User-Agent': 'AI-Code-Review-App',
      },
    });

    if (!ghRes.ok) {
      const errData = await ghRes.json().catch(() => ({}));
      return res.status(ghRes.status).json({ message: 'GitHub API error fetching profile', details: errData });
    }

    const profileData = await ghRes.json();
    res.json({
      success: true,
      githubUserId: user.githubUserId,
      user: profileData,
    });
  } catch (error) {
    console.error('Fetch GitHub profile error:', error);
    res.status(500).json({ message: 'Failed to fetch GitHub profile', error: error.message });
  }
});

// GET /github/repos - Fetch authenticated user's GitHub repositories
router.get('/repos', async (req, res) => {
  try {
    const targetUserId = getUserIdFromReq(req);
    if (!targetUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await User.findById(targetUserId);
    if (!user || !user.githubAccessToken) {
      return res.status(401).json({ message: 'GitHub account not connected for user' });
    }

    const decryptedToken = decrypt(user.githubAccessToken);
    if (!decryptedToken) {
      return res.status(401).json({ message: 'Failed to decrypt stored GitHub access token' });
    }

    const ghRes = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
      headers: {
        'Authorization': `Bearer ${decryptedToken}`,
        'User-Agent': 'AI-Code-Review-App',
      },
    });

    if (!ghRes.ok) {
      const errData = await ghRes.json().catch(() => ({}));
      return res.status(ghRes.status).json({ message: 'GitHub API error fetching repositories', details: errData });
    }

    const reposData = await ghRes.json();
    res.json({
      success: true,
      repos: reposData,
    });
  } catch (error) {
    console.error('Fetch GitHub repos error:', error);
    res.status(500).json({ message: 'Failed to fetch GitHub repositories', error: error.message });
  }
});

// GET /github/status - Check connection status and Git repository status
router.get('/status', async (req, res) => {
  try {
    const targetUserId = getUserIdFromReq(req);
    const { repoId, storagePath } = req.query;

    let isConnected = false;
    let githubUserId = null;

    if (targetUserId) {
      const user = await User.findById(targetUserId);
      if (user && user.githubAccessToken) {
        isConnected = true;
        githubUserId = user.githubUserId;
      }
    }

    let gitStatus = null;
    let targetPath = storagePath;

    if (repoId) {
      const repo = await Repository.findById(repoId);
      if (repo && repo.metadata && repo.metadata.storagePath) {
        targetPath = repo.metadata.storagePath;
      }
    }

    if (targetPath) {
      try {
        const git = simpleGit(targetPath).env({ GIT_TERMINAL_PROMPT: '0' });
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
          const status = await git.status();
          const log = await git.log({ maxCount: 1 }).catch(() => null);

          gitStatus = {
            isRepo: true,
            currentBranch: status.current,
            isClean: status.isClean(),
            modifiedCount: status.modified.length,
            createdCount: status.not_added.length,
            deletedCount: status.deleted.length,
            ahead: status.ahead,
            behind: status.behind,
            latestCommit: log && log.latest ? {
              hash: log.latest.hash,
              author: log.latest.author_name,
              message: log.latest.message,
              date: log.latest.date,
            } : null,
          };
        } else {
          gitStatus = { isRepo: false, message: 'Path is not a git repository' };
        }
      } catch (gitErr) {
        gitStatus = { isRepo: false, error: gitErr.message };
      }
    }

    res.json({
      isConnected,
      githubUserId,
      gitStatus,
    });
  } catch (error) {
    console.error('GitHub status error:', error);
    res.status(500).json({ message: 'Failed to fetch GitHub status', error: error.message });
  }
});

// POST /github/commit - Execute git add . and git commit
router.post('/commit', workspaceAuth, async (req, res) => {
  try {
    const { message, push: shouldPush } = req.body;
    const targetPath = await resolveStoragePath(req);

    if (!targetPath) {
      return res.status(400).json({ success: false, error: 'Repository storage path or valid repoId/projectId is required' });
    }

    const git = simpleGit(targetPath).env({ GIT_TERMINAL_PROMPT: '0' });
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Target directory is not a valid Git repository' });
    }

    const targetUserId = getUserIdFromReq(req);
    let authorName = 'AI Code Review';
    let authorEmail = 'noreply@aicode.com';
    if (targetUserId) {
      const user = await User.findById(targetUserId);
      if (user) {
        authorEmail = user.email || authorEmail;
        authorName = user.githubUserId || authorName;
      }
    }

    await git.addConfig('user.name', authorName);
    await git.addConfig('user.email', authorEmail);

    const commitMsg = message || `Update code - ${new Date().toISOString()}`;

    // 1. git add .
    await git.add('.');

    // 2. git commit -m message
    const commitResult = await git.commit(commitMsg);

    let pushResult = null;
    if (shouldPush) {
      pushResult = await executePush(req, git, targetPath);
      if (!pushResult.success) {
        return res.status(400).json({
          success: false,
          committed: true,
          pushed: false,
          commitResult,
          error: pushResult.error,
        });
      }
    }

    res.json({
      success: true,
      message: shouldPush ? 'Committed and pushed changes successfully' : 'Committed changes successfully',
      commitResult,
      pushResult,
    });
  } catch (error) {
    console.error('Git commit error:', error);
    res.status(500).json({ success: false, error: 'Failed to commit changes', details: error.message });
  }
});

// POST /github/push - Fetch remote state, verify local branch is not behind, and push
router.post('/push', workspaceAuth, async (req, res) => {
  try {
    const targetPath = await resolveStoragePath(req);

    if (!targetPath) {
      return res.status(400).json({ success: false, error: 'Repository storage path or valid repoId/projectId is required' });
    }

    const git = simpleGit(targetPath).env({ GIT_TERMINAL_PROMPT: '0' });
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Target directory is not a valid Git repository' });
    }

    const pushResult = await executePush(req, git, targetPath);
    if (!pushResult.success) {
      return res.status(400).json(pushResult);
    }

    res.json(pushResult);
  } catch (error) {
    console.error('Git push error:', error);
    res.status(500).json({ success: false, error: 'Failed to push changes to remote repository', details: error.message });
  }
});

// POST /github/pull - Execute git pull
router.post('/pull', workspaceAuth, async (req, res) => {
  try {
    const targetPath = await resolveStoragePath(req);

    if (!targetPath) {
      return res.status(400).json({ success: false, error: 'Repository storage path or valid repoId/projectId is required' });
    }

    const git = simpleGit(targetPath).env({ GIT_TERMINAL_PROMPT: '0' });
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      return res.status(400).json({ success: false, error: 'Target directory is not a valid Git repository' });
    }

    const targetUserId = getUserIdFromReq(req);
    if (targetUserId) {
      try {
        const user = await User.findById(targetUserId);
        if (user && user.githubAccessToken) {
          const decryptedToken = decrypt(user.githubAccessToken);
          if (decryptedToken) {
            const remotes = await git.getRemotes(true);
            const originRemote = remotes.find(r => r.name === 'origin');
            if (originRemote && originRemote.refs.fetch && originRemote.refs.fetch.startsWith('https://github.com/')) {
              const authFetchUrl = originRemote.refs.fetch.replace('https://github.com/', `https://${decryptedToken}@github.com/`);
              await git.remote(['set-url', 'origin', authFetchUrl]);
            }
          }
        }
      } catch (err) {
        console.warn('Could not set authenticated git remote URL for pull:', err.message);
      }
    }

    const pullResult = await git.pull();

    const tree = await parseDirectory(targetPath);
    const langStats = calculateLanguageStats(tree);

    res.json({
      success: true,
      message: 'Pulled latest changes successfully',
      pullResult,
      tree,
      languageStats: langStats,
    });
  } catch (error) {
    console.error('Git pull error:', error);
    res.status(500).json({ success: false, error: 'Failed to pull changes from remote repository', details: error.message });
  }
});


// ─── OWNERSHIP DETECTION ──────────────────────────────────────────────────────

// POST /github/detect-repo — Detects ownership of a GitHub repository URL
router.post('/detect-repo', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ message: 'Valid repository URL is required' });
    }

    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (!match) {
      return res.status(400).json({ message: 'Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)' });
    }
    const [, owner, repo] = match;

    const targetUserId = getUserIdFromReq(req);
    let decryptedToken = null;
    let authenticatedLogin = null;

    if (targetUserId) {
      const user = await User.findById(targetUserId);
      if (user && user.githubAccessToken) {
        decryptedToken = decrypt(user.githubAccessToken);
      }
    }

    // Fetch authenticated user profile
    if (decryptedToken) {
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${decryptedToken}`,
          'User-Agent': 'AI-Code-Review-App',
        },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        authenticatedLogin = userData.login;
      }
    }

    // Fetch target repository info
    const headers = {
      'User-Agent': 'AI-Code-Review-App',
      'Accept': 'application/vnd.github+json',
    };
    if (decryptedToken) headers['Authorization'] = `Bearer ${decryptedToken}`;

    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

    if (repoRes.status === 404) {
      return res.status(404).json({ message: 'Repository not found or is private. Make sure the URL is correct and you have access.' });
    }
    if (repoRes.status === 403 || repoRes.status === 401) {
      return res.status(403).json({ message: 'This repository is private. Please connect your GitHub account with the necessary permissions.' });
    }
    if (repoRes.status === 429) {
      return res.status(429).json({ message: 'GitHub API rate limit reached. Please wait a few minutes and try again.' });
    }
    if (!repoRes.ok) {
      return res.status(repoRes.status).json({ message: `GitHub API error: ${repoRes.statusText}` });
    }

    const repoInfo = await repoRes.json();
    const repoOwnerLogin = repoInfo.owner.login;
    const repoType = (authenticatedLogin && repoOwnerLogin.toLowerCase() === authenticatedLogin.toLowerCase())
      ? 'OWN_REPOSITORY'
      : 'EXTERNAL_REPOSITORY';

    res.json({
      success: true,
      repoType,
      authenticatedLogin,
      repoInfo: {
        fullName: repoInfo.full_name,
        owner: repoOwnerLogin,
        name: repoInfo.name,
        description: repoInfo.description,
        private: repoInfo.private,
        defaultBranch: repoInfo.default_branch,
        cloneUrl: repoInfo.clone_url,
        htmlUrl: repoInfo.html_url,
        starCount: repoInfo.stargazers_count,
        forkCount: repoInfo.forks_count,
      },
    });
  } catch (error) {
    console.error('detect-repo error:', error);
    res.status(500).json({ message: 'Failed to detect repository ownership', error: error.message });
  }
});

// GET /github/repo-info — Fetch GitHub repo metadata (including parent for forks)
router.get('/repo-info', async (req, res) => {
  try {
    const { owner, repo } = req.query;
    if (!owner || !repo) {
      return res.status(400).json({ message: 'owner and repo query params are required' });
    }

    const targetUserId = getUserIdFromReq(req);
    let decryptedToken = null;
    if (targetUserId) {
      const user = await User.findById(targetUserId);
      if (user && user.githubAccessToken) decryptedToken = decrypt(user.githubAccessToken);
    }

    const headers = { 'User-Agent': 'AI-Code-Review-App', 'Accept': 'application/vnd.github+json' };
    if (decryptedToken) headers['Authorization'] = `Bearer ${decryptedToken}`;

    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoRes.ok) {
      return res.status(repoRes.status).json({ message: `GitHub API error fetching repo info` });
    }
    const repoData = await repoRes.json();
    res.json({ success: true, repo: repoData });
  } catch (error) {
    console.error('repo-info error:', error);
    res.status(500).json({ message: 'Failed to fetch repo info', error: error.message });
  }
});

// POST /github/fork — Fork a repository to the authenticated user's account
router.post('/fork', async (req, res) => {
  try {
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      return res.status(400).json({ message: 'owner and repo are required' });
    }

    const targetUserId = getUserIdFromReq(req);
    if (!targetUserId) return res.status(401).json({ message: 'Authentication required' });

    const user = await User.findById(targetUserId);
    if (!user || !user.githubAccessToken) {
      return res.status(401).json({ message: 'GitHub account not connected. Please connect your GitHub account first.' });
    }
    const decryptedToken = decrypt(user.githubAccessToken);
    if (!decryptedToken) return res.status(401).json({ message: 'Failed to decrypt GitHub access token' });

    const headers = {
      'Authorization': `Bearer ${decryptedToken}`,
      'User-Agent': 'AI-Code-Review-App',
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    // Trigger fork
    const forkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/forks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (forkRes.status === 422) {
      // Fork may already exist — fetch it
      const userRes = await fetch('https://api.github.com/user', { headers });
      const userData = await userRes.json();
      const existingForkRes = await fetch(`https://api.github.com/repos/${userData.login}/${repo}`, { headers });
      if (existingForkRes.ok) {
        const existingFork = await existingForkRes.json();
        return res.json({
          success: true,
          alreadyExisted: true,
          message: 'Fork already exists. Using your existing fork.',
          fork: { clone_url: existingFork.clone_url, html_url: existingFork.html_url, full_name: existingFork.full_name, default_branch: existingFork.default_branch },
        });
      }
    }
    if (forkRes.status === 429) return res.status(429).json({ message: 'GitHub API rate limit reached. Please wait a few minutes.' });
    if (!forkRes.ok) {
      const errData = await forkRes.json().catch(() => ({}));
      return res.status(forkRes.status).json({ message: `Failed to fork repository: ${errData.message || forkRes.statusText}` });
    }

    const forkData = await forkRes.json();
    const forkedOwner = forkData.owner.login;
    const forkedRepo = forkData.name;

    // Poll until fork is available (up to 30s)
    let forkReady = false;
    let finalFork = forkData;
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      const checkRes = await fetch(`https://api.github.com/repos/${forkedOwner}/${forkedRepo}`, { headers });
      if (checkRes.ok) {
        finalFork = await checkRes.json();
        forkReady = true;
        break;
      }
    }

    if (!forkReady) {
      return res.status(504).json({ message: 'Fork was created but took too long to become available. Please try importing it manually.' });
    }

    res.json({
      success: true,
      alreadyExisted: false,
      message: 'Repository forked successfully',
      fork: {
        clone_url: finalFork.clone_url,
        html_url: finalFork.html_url,
        full_name: finalFork.full_name,
        default_branch: finalFork.default_branch,
      },
    });
  } catch (error) {
    console.error('fork error:', error);
    res.status(500).json({ message: 'Failed to fork repository', error: error.message });
  }
});

// POST /github/create-pr — Create a Pull Request from fork to original repo
router.post('/create-pr', async (req, res) => {
  try {
    const { originalOwner, originalRepo, head, title, body, base } = req.body;
    if (!originalOwner || !originalRepo || !head || !title) {
      return res.status(400).json({ message: 'originalOwner, originalRepo, head, and title are required' });
    }

    const targetUserId = getUserIdFromReq(req);
    if (!targetUserId) return res.status(401).json({ message: 'Authentication required' });

    const user = await User.findById(targetUserId);
    if (!user || !user.githubAccessToken) {
      return res.status(401).json({ message: 'GitHub account not connected' });
    }
    const decryptedToken = decrypt(user.githubAccessToken);
    if (!decryptedToken) return res.status(401).json({ message: 'Failed to decrypt GitHub access token' });

    const headers = {
      'Authorization': `Bearer ${decryptedToken}`,
      'User-Agent': 'AI-Code-Review-App',
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    const prRes = await fetch(`https://api.github.com/repos/${originalOwner}/${originalRepo}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title,
        body: body || '',
        head,
        base: base || 'main',
        maintainer_can_modify: true,
      }),
    });

    if (prRes.status === 422) {
      const errData = await prRes.json().catch(() => ({}));
      const isDuplicate = errData.errors?.some(e => e.message?.includes('already exists'));
      if (isDuplicate) {
        // Find the existing PR
        const existingPrRes = await fetch(
          `https://api.github.com/repos/${originalOwner}/${originalRepo}/pulls?head=${head}&state=open`,
          { headers }
        );
        if (existingPrRes.ok) {
          const existing = await existingPrRes.json();
          if (existing.length > 0) {
            return res.json({
              success: true,
              alreadyExists: true,
              message: 'A pull request already exists for this branch.',
              pr: { html_url: existing[0].html_url, number: existing[0].number, title: existing[0].title },
            });
          }
        }
        return res.status(422).json({ message: 'A pull request for this branch already exists.' });
      }
      
      // Extract specific validation error messages if available (e.g. "No commits between X and Y")
      if (errData.errors && errData.errors.length > 0) {
        const detailedMsg = errData.errors.map(e => e.message).filter(Boolean).join('. ');
        if (detailedMsg) {
          return res.status(422).json({ message: `Validation Failed: ${detailedMsg}`, errors: errData.errors });
        }
      }
      return res.status(422).json({ message: errData.message || 'Validation error creating pull request', errors: errData.errors });
    }
    if (prRes.status === 429) return res.status(429).json({ message: 'GitHub API rate limit reached. Please wait and try again.' });
    if (!prRes.ok) {
      const errData = await prRes.json().catch(() => ({}));
      return res.status(prRes.status).json({ message: `Failed to create pull request: ${errData.message || prRes.statusText}` });
    }

    const prData = await prRes.json();
    res.json({
      success: true,
      alreadyExists: false,
      message: 'Pull request created successfully!',
      pr: { html_url: prData.html_url, number: prData.number, title: prData.title },
    });
  } catch (error) {
    console.error('create-pr error:', error);
    res.status(500).json({ message: 'Failed to create pull request', error: error.message });
  }
});

module.exports = router;

