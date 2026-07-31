const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { encrypt } = require('../utils/cryptoUtils');
const { createRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'my-super-secret-jwt-key';

// Helper function for exchanging GitHub OAuth code for access token with automatic fallback
async function exchangeGithubCode(code, redirectUri) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET environment variable is missing.');
  }

  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
  };

  if (redirectUri) {
    payload.redirect_uri = redirectUri;
  }

  // First Attempt: with redirect_uri
  let tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let tokenData = await tokenRes.json();

  // Second Attempt (Fallback): If failed with redirect_uri, try without redirect_uri
  if (!tokenData.access_token && payload.redirect_uri) {
    delete payload.redirect_uri;
    tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    tokenData = await tokenRes.json();
  }

  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange GitHub authorization code for token');
  }

  return tokenData.access_token;
}

// Helper function to fetch GitHub user details
async function fetchGithubUserDetails(accessToken) {
  let githubUserId = null;
  let email = null;
  let username = null;

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'AI-Code-Review-App',
    },
  });
  const userData = await userRes.json();

  if (userData && userData.id) {
    githubUserId = String(userData.id);
    email = userData.email;
    username = userData.login;
  }

  // If email is private on GitHub profile, query /user/emails endpoint
  if (!email && accessToken) {
    try {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'AI-Code-Review-App',
        },
      });
      const emailsData = await emailRes.json();
      if (Array.isArray(emailsData) && emailsData.length > 0) {
        const primary = emailsData.find(e => e.primary) || emailsData[0];
        email = primary.email;
      }
    } catch (e) {
      console.warn('Could not fetch GitHub user emails:', e.message);
    }
  }

  if (!email) {
    email = `${username || githubUserId || Date.now()}@github.com`;
  }

  return { githubUserId, email, userData };
}

// Register a new user
const registerLimiter = createRateLimiter({
  type: 'register',
  limit: 5,
  windowSeconds: 3600, // 1 hour
  customMessage: 'Too many registration attempts. Please try again after 1 hour.'
});

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = new User({ email, passwordHash });
    await newUser.save();

    const token = jwt.sign({ userId: newUser._id }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({ token, user: { id: newUser._id, email: newUser.email } });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login user
const loginLimiter = createRateLimiter({
  type: 'login',
  limit: 5,
  windowSeconds: 900, // 15 minutes
  customMessage: 'Too many login attempts. Please try again after 15 minutes.'
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, user: { id: user._id, email: user.email, githubUserId: user.githubUserId } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// GET /api/auth/github - Redirect to GitHub OAuth Authorization Page
router.get('/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const callbackUrl = process.env.GITHUB_CALLBACK_URL;

  if (!clientId) {
    return res.status(400).json({ message: 'GITHUB_CLIENT_ID environment variable is not configured on backend' });
  }

  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=repo,user,user:email`;
  res.redirect(githubAuthUrl);
});

// GET /api/auth/github/callback - GitHub OAuth Callback handling authorization code exchange & redirect
router.get('/github/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const callbackUrl = process.env.GITHUB_CALLBACK_URL;

    if (!code) {
      return res.status(400).json({ message: 'Missing authorization code in GitHub callback' });
    }

    const accessToken = await exchangeGithubCode(code, callbackUrl);
    const { githubUserId, email } = await fetchGithubUserDetails(accessToken);
    const encryptedToken = encrypt(accessToken);

    let user = await User.findOne({
      $or: [
        { githubUserId: githubUserId },
        { email: email },
      ],
    });

    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(Date.now().toString(), salt);

      user = new User({
        email,
        passwordHash,
        githubUserId: githubUserId || `gh-${Date.now()}`,
        githubAccessToken: encryptedToken,
      });
      await user.save();
      console.log(`✅ [GitHub OAuth Callback] Created user: ${email}`);
    } else {
      user.githubUserId = githubUserId || user.githubUserId;
      user.githubAccessToken = encryptedToken;
      await user.save();
      console.log(`✅ [GitHub OAuth Callback] Updated user: ${user.email}`);
    }

    const jwtToken = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });

    const frontendUrl = process.env.FRONTEND_URL;
    const redirectTarget = `${frontendUrl}/github/callback?token=${jwtToken}&user=${encodeURIComponent(JSON.stringify({ id: user._id, email: user.email, githubUserId: user.githubUserId }))}`;
    res.redirect(redirectTarget);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    res.status(500).json({ message: 'GitHub callback error', error: error.message });
  }
});

// POST /api/auth/github - JSON endpoint for direct frontend OAuth code or token exchange
router.post('/github', async (req, res) => {
  try {
    const { code, redirect_uri, accessToken: directToken, githubUserId: directGithubUserId, email: directEmail } = req.body;

    let accessToken = directToken;
    let githubUserId = directGithubUserId;
    let email = directEmail;

    if (code && !accessToken) {
      const callbackUrl = redirect_uri || process.env.GITHUB_CALLBACK_URL;
      accessToken = await exchangeGithubCode(code, callbackUrl);
    }

    if (accessToken && !githubUserId) {
      const details = await fetchGithubUserDetails(accessToken);
      githubUserId = details.githubUserId;
      email = details.email || email;
    }

    if (!githubUserId && !email) {
      githubUserId = `gh-${Date.now()}`;
      email = `${githubUserId}@github.com`;
    }

    const encryptedToken = accessToken ? encrypt(accessToken) : null;

    let user = await User.findOne({
      $or: [
        { githubUserId: githubUserId },
        { email: email },
      ],
    });

    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(Date.now().toString(), salt);

      user = new User({
        email: email,
        passwordHash,
        githubUserId: githubUserId,
        githubAccessToken: encryptedToken,
      });
      await user.save();
    } else {
      user.githubUserId = githubUserId || user.githubUserId;
      if (encryptedToken) {
        user.githubAccessToken = encryptedToken;
      }
      await user.save();
    }

    const jwtToken = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token: jwtToken,
      user: {
        id: user._id,
        email: user.email,
        githubUserId: user.githubUserId,
      },
    });
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.status(500).json({ message: 'GitHub authentication error', error: error.message });
  }
});

module.exports = router;
