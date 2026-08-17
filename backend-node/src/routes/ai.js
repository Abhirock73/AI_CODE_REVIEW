const express = require('express');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');
const authMiddleware = require('../middleware/auth');
const workspaceAuth = require('../middleware/workspaceAuth');
const ReviewHistory = require('../models/ReviewHistory');
const Repository = require('../models/Repository');
const { getCache, setCache } = require('../services/redisCache');
const RedisCacheService = require('../services/RedisCacheService');

// ── NEW: AI Review Pipeline (Steps 1-10) ─────────────────────────────────────
const { runFullReviewPipeline, progressEmitter } = require('../services/reviewPipeline');
const { createRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ── Environment Variable Pre-flight ──────────────────────────────────────────
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log(`[AI Initialization] GROQ_API_KEY configured  : ${Boolean(GROQ_API_KEY)}`);
console.log(`[AI Initialization] GEMINI_API_KEY configured: ${Boolean(GEMINI_API_KEY)}`);

if (!GROQ_API_KEY) {
  console.warn('[AI Initialization] ⚠️  GROQ_API_KEY is not set — Groq LLM calls will be skipped.');
}
if (!GEMINI_API_KEY) {
  console.warn('[AI Initialization] ⚠️  GEMINI_API_KEY is not set — Gemini chat/fallback will be unavailable.');
}

// ── API Clients ───────────────────────────────────────────────────────────────
const openai = GROQ_API_KEY ? new OpenAI({
  apiKey: GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
}) : null;

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const MODEL_CANDIDATES = [
  "llama3-8b-8192",
  "llama3-70b-8192",
  "llama3-8b-8192"
];

// ── Rich LLM Error Logger ─────────────────────────────────────────────────────
/**
 * Logs every available field from an LLM SDK error so the root cause
 * (401, 429, region block, malformed key, etc.) appears clearly in the terminal.
 */
function logLLMError(provider, modelName, err) {
  const status     = err.status ?? err.statusCode ?? err.code ?? 'unknown';
  const headers    = err.headers ?? err.response?.headers ?? {};
  const body       = err.error  ?? err.body       ?? err.data ?? null;
  const retryAfter = headers['retry-after'] ?? headers['x-ratelimit-reset-requests'] ?? null;

  console.error(`\n${'─'.repeat(60)}`);
  console.error(`❌ [${provider}] Model "${modelName}" API call FAILED`);
  console.error(`   HTTP Status  : ${status}`);
  console.error(`   Error Msg   : ${err.message}`);
  if (retryAfter) {
    console.error(`   Retry-After : ${retryAfter}`);
  }
  const usefulHeaders = {};
  for (const h of [
    'retry-after', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests', 'www-authenticate', 'x-error-code',
  ]) {
    if (headers[h]) usefulHeaders[h] = headers[h];
  }
  if (Object.keys(usefulHeaders).length) {
    console.error(`   Rate-limit Headers:`, JSON.stringify(usefulHeaders, null, 2));
  }
  if (body) {
    console.error(`   Provider Error Body:`, typeof body === 'object' ? JSON.stringify(body, null, 2) : body);
  }
  console.error(`${'─'.repeat(60)}\n`);
}

/**
 * Static analysis fallback – runs basic heuristics without any LLM
 */
function staticAnalysisFallback(fileContent, filePath, language) {
  const lines = fileContent.split('\n');
  const lineCount = lines.length;
  const security = [];
  const refactoring = [];
  const comments = [];

  // Basic security checks
  if (/eval\s*\(/.test(fileContent)) security.push({ severity: 'high', issue: 'Use of eval() detected – can lead to code injection.', file: filePath });
  if (/password\s*=\s*["'][^"']+["']/i.test(fileContent)) security.push({ severity: 'high', issue: 'Hardcoded password detected.', file: filePath });
  if (/secret\s*=\s*["'][^"']+["']/i.test(fileContent)) security.push({ severity: 'high', issue: 'Hardcoded secret detected.', file: filePath });
  if (/TODO|FIXME|HACK/i.test(fileContent)) refactoring.push({ suggestion: 'TODO/FIXME/HACK comment found – review and resolve.', file: filePath });
  if (lineCount > 300) refactoring.push({ suggestion: `File is ${lineCount} lines long – consider splitting into smaller modules.`, file: filePath });

  // Estimate score
  let score = 75;
  if (security.filter(s => s.severity === 'high').length > 0) score -= 20;
  if (lineCount > 500) score -= 10;
  if (refactoring.length > 2) score -= 5;
  score = Math.max(20, Math.min(100, score));

  return { score, security, refactoring, comments };
}

/**
 * Helper to generate content trying candidate models until one succeeds
 */
async function generateContentWithFallback(openaiClient, prompt, jsonFormat = false) {
  let lastError = null;
  for (const modelName of MODEL_CANDIDATES) {
    try {
      console.log(`🟢 [Groq LLM] Trying model: "${modelName}"...`);
      const response = await openaiClient.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        response_format: jsonFormat ? { type: 'json_object' } : undefined
      });
      const text = response.choices[0].message.content;
      console.log(`✅ [Groq LLM] Model "${modelName}" succeeded!`);
      return { result: { response: { text: () => text } }, modelName, text };
    } catch (err) {
      logLLMError('Groq LLM', modelName, err);
      // Auth errors are fatal — no point retrying other models
      if (err.status === 401 || err.status === 403) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Helper to start chat trying candidate models until one succeeds
 */
async function sendChatWithFallback(openaiClient, history, userMessage) {
  let lastError = null;
  const messages = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'assistant',
    content: h.parts.map(p => p.text).join('\n')
  }));
  messages.push({ role: 'user', content: userMessage });

  for (const modelName of MODEL_CANDIDATES) {
    try {
      console.log(`🟢 [Groq Chat] Trying model: "${modelName}"...`);
      const response = await openaiClient.chat.completions.create({
        model: modelName,
        messages: messages
      });
      const text = response.choices[0].message.content;
      console.log(`✅ [Groq Chat] Model "${modelName}" succeeded!`);
      return { result: { response: { text: () => text } }, modelName, text };
    } catch (err) {
      logLLMError('Groq Chat', modelName, err);
      // Auth errors are fatal — no point retrying other models
      if (err.status === 401 || err.status === 403) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// Health check endpoint for AI service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-service-js',
    configured: Boolean(GROQ_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// Review a file via Gemini API in Node.js
router.post('/review-file', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const { code, language = 'unknown', filename = 'file', repositoryId } = req.body;

    if (!code) return res.status(400).json({ message: 'code is required' });

    console.log(`\n==================================================`);
    console.log(`🚀 [AI Review Request] File: "${filename}" | Language: "${language}" | Length: ${code.length} chars`);
    console.log(`--------------------------------------------------`);
    console.log(`📄 Code snippet sent to LLM:\n${code.slice(0, 300)}${code.length > 300 ? '\n...' : ''}`);
    console.log(`--------------------------------------------------`);

    let reviewData;

    if (!openai) {
      console.log("⚠️ [AI Review Warning] GROQ_API_KEY is NOT configured in .env. Returning rich mock response.");
      reviewData = {
        score: 72,
        summary: "The code is functional but has several areas for improvement in readability and security.",
        refactoring: [
          { line: null, issue: "Functions are too long and handle multiple concerns.", suggestion: "Break into smaller, single-responsibility functions." },
          { line: null, issue: "Magic numbers used without named constants.", suggestion: "Extract numeric literals to named constants for clarity." }
        ],
        security: [
          { severity: "medium", description: "User input is not sanitized before use.", suggestion: "Validate and sanitize all external inputs." }
        ],
        comments: [
          "Consider adding JSDoc/docstring comments to all exported functions.",
          "Error handling could be more granular — catching generic exceptions may hide real issues."
        ]
      };
      console.log(`📊 [Mock AI Review Result] for "${filename}":`);
      console.log(JSON.stringify(reviewData, null, 2));
      console.log(`==================================================\n`);
    } else {
      try {
        const prompt = `You are an expert senior software engineer performing a rigorous and highly critical code review.

Analyze the following ${language} code from the file \`${filename}\` and return a structured JSON response ONLY (no markdown fences, no explanation outside JSON).

CRITICAL INSTRUCTION: You must actively look for and flag the following:
1. Logic Bugs (e.g., infinite loops, off-by-one errors, unreachable code) - flag these under \`security\` or \`refactoring\`.
2. Security Vulnerabilities (e.g., injection flaws, unvalidated inputs, denial of service risks like infinite loops).
3. Code Quality Issues (e.g., poor variable naming, lack of modularity).

Do not be lenient. If the code has a blatant logic error like an infinite loop, you MUST report it.

The JSON must conform to exactly this schema:
{
  "score": <integer 0-100>,
  "summary": "<one-sentence overall assessment>",
  "refactoring": [
    { "line": <line_number_or_null>, "issue": "<description>", "suggestion": "<how to fix it>" }
  ],
  "security": [
    { "severity": "<high|medium|low>", "description": "<vulnerability description>", "suggestion": "<remediation>" }
  ],
  "comments": [
    "<general observation or best-practice note>"
  ]
}

Code to review:
\`\`\`${language}
${code.slice(0, 100000)}
\`\`\``;

        const { text, modelName } = await generateContentWithFallback(openai, prompt, true);
        let responseText = text.trim();

        // Strip markdown fences if present
        if (responseText.startsWith("```json")) {
          responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (responseText.startsWith("```")) {
          responseText = responseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        reviewData = JSON.parse(responseText);

        console.log(`📊 [AI Review Result (${modelName})] Output for "${filename}":`);
        console.log(JSON.stringify(reviewData, null, 2));
        console.log(`==================================================\n`);
      } catch (aiErr) {
        console.error(`❌ [Gemini LLM Error] Review failed for file "${filename}":`, aiErr);
        if (aiErr instanceof SyntaxError) {
          return res.status(500).json({ message: "AI returned malformed JSON. Please retry." });
        }
        
        // Fallback to basic static analysis for the single file
        console.log(`[Single File Review] Gemini auth failed. Falling back to static analysis for ${filename}.`);
        
        let score = 85;
        let security = [];
        let refactoring = [];
        let comments = ["Analyzed using local heuristic fallback (Gemini API key invalid or missing)."];
        
        const lines = code.split('\n');
        lines.forEach((lineText, idx) => {
          const lineNumber = idx + 1;
          const text = lineText.toLowerCase();
          
          if (text.includes('password') || text.includes('secret') || text.includes('api_key') || text.includes('token')) {
            security.push({ line: lineNumber, severity: 'high', description: 'Potential hardcoded secret or password found', suggestion: 'Use environment variables for secrets.' });
            score -= 10;
          }
          if (text.includes('eval(')) {
            security.push({ line: lineNumber, severity: 'high', description: 'Usage of eval() detected', suggestion: 'Avoid eval() as it can lead to code injection vulnerabilities.' });
            score -= 15;
          }
          if (text.includes('console.log')) {
            refactoring.push({ line: lineNumber, issue: 'Leftover console.log statement', suggestion: 'Remove or replace with a proper logging framework.' });
            score -= 2;
          }
          if (text.includes('todo') || text.includes('fixme')) {
            comments.push(`Line ${lineNumber}: TODO/FIXME comment found - remember to address it.`);
            score -= 1;
          }
        });
        
        if (lines.length > 300) {
           refactoring.push({ line: null, issue: 'File is quite large', suggestion: 'Consider breaking this file into smaller, more focused modules.' });
           score -= 5;
        }
        
        reviewData = {
          score: Math.max(0, score),
          summary: security.length > 0 ? "Potential security issues detected in static analysis." : "Code looks generally fine via static analysis.",
          refactoring,
          security,
          comments
        };
      }
    }

    // Save to ReviewHistory if repositoryId provided
    if (repositoryId) {
      try {
        let workspaceId = null;
        let repositoryType = 'github';
        try {
          const WorkspaceManager = require('../services/WorkspaceManager');
          const workspace = await WorkspaceManager.getWorkspace(repositoryId, req.userId, false);
          if (workspace) {
            workspaceId = workspace.workspaceId;
            repositoryType = workspace.repositoryType;
          }
        } catch (err) {}

        const review = new ReviewHistory({
          repositoryId,
          workspaceId,
          repositoryType,
          commitHash: filename || 'manual-review',
          reviewData,
        });
        await review.save();
      } catch (dbErr) {
        console.error('Failed to save review history:', dbErr);
      }
    }

    res.json(reviewData);
  } catch (error) {
    console.error('AI review endpoint error:', error);
    res.status(500).json({ message: 'Internal server error in AI review' });
  }
});

// Chat with AI about the repository
router.post('/chat', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const { message, repoId = 'general', repoContext } = req.body;

    if (!message) return res.status(400).json({ message: 'message is required' });

    console.log(`\n--------------------------------------------------`);
    console.log(`💬 [AI Chat Request] Repo: "${repoId}" | Message: "${message}"`);

    const userId = req.userId;
    const cacheKey = `chat:${userId}:${repoId}`;

    // Fetch history from Redis
    const history = (await getCache(cacheKey)) || [];

    if (!genAI) {
      console.log(`⚠️ [AI Chat Warning] GEMINI_API_KEY is NOT configured. Returning mock chat reply.`);
      const mockReply = `I can see you're asking about: **${message}**. This is a mock AI response — please configure a GEMINI_API_KEY to get real answers about your repository.`;
      history.push({ role: 'user', content: message });
      history.push({ role: 'model', content: mockReply });
      await setCache(cacheKey, history.slice(-40), 3600);
      return res.json({ reply: mockReply });
    }

    try {
      const geminiHistory = history.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const systemContext = `You are an expert AI code review assistant. The user is analyzing a code repository.
Repository context: ${repoContext || 'No additional context provided.'}
Be concise, technical, and helpful. Format responses with markdown where appropriate.`;

      let userMessage = message;
      if (history.length === 0) {
        userMessage = `${systemContext}\n\nUser: ${message}`;
      }

      const { result, modelName } = await sendChatWithFallback(genAI, geminiHistory, userMessage);
      const reply = result.response.text();

      console.log(`🤖 [Gemini Chat Response (${modelName})]: "${reply.slice(0, 150)}..."`);
      console.log(`--------------------------------------------------\n`);

      history.push({ role: 'user', content: message });
      history.push({ role: 'model', content: reply });
      await setCache(cacheKey, history.slice(-40), 3600);

      res.json({ reply });
    } catch (aiErr) {
      console.error("Gemini Chat error:", aiErr);
      res.status(500).json({ message: `AI chat failed: ${aiErr.message}` });
    }
  } catch (error) {
    console.error('AI chat endpoint error:', error);
    res.status(500).json({ message: 'Internal server error in AI chat' });
  }
});

// ── SSE Endpoint for Real-time Progress ──────────────────────────────────────
router.get('/review-progress/:repositoryId', authMiddleware, workspaceAuth, (req, res) => {
  const { repositoryId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onProgress = (msg) => {
    res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
  };

  const eventName = `progress-${repositoryId}`;
  progressEmitter.on(eventName, onProgress);

  req.on('close', () => {
    progressEmitter.removeListener(eventName, onProgress);
  });
});

// ── Full Repository AI Review (NEW PIPELINE) ─────────────────────────────────
// Replaces the old per-file loop with the 10-step review pipeline:
//   Scan → Language → Static Analysis → Dependency Graph → Chunk →
//   Rank → Context → Prompt → Cache → LLM → Aggregate
//
// Response shape is unchanged:  { message, review: ReviewHistory }
// so the existing frontend (QualityDashboard, AiReviewPanel) requires NO changes.
const reviewLimiter = createRateLimiter({
  type: 'review',
  limit: 10,
  windowSeconds: 60, // 1 minute
  customMessage: 'Too many review requests. Please try again after 1 minute.'
});

router.post('/review-repo', authMiddleware, workspaceAuth, reviewLimiter, async (req, res) => {
  try {
    const { repositoryId } = req.body;
    if (!repositoryId) {
      return res.status(400).json({ message: 'Missing repositoryId' });
    }

    const repo = await Repository.findOne({ _id: repositoryId, userId: req.userId });
    if (!repo) {
      return res.status(404).json({ message: 'Repository not found' });
    }

    const WorkspaceManager = require('../services/WorkspaceManager');
    const workspace = await WorkspaceManager.getWorkspace(repositoryId, req.userId);

    const storagePath = repo.metadata.storagePath;
    if (!storagePath) {
      return res.status(400).json({ message: 'Repository storage path not found' });
    }

    if (!openai) {
      return res.status(503).json({ message: 'AI service is not configured. Please set GROQ_API_KEY in .env.' });
    }

    // ── Check Redis Cache ─────────────────────────────────────────────────────
    const cacheKey = RedisCacheService.generateCacheKey(repo);
    if (cacheKey) {
      console.log(`[review-repo] Generated cache key: ${cacheKey}`);
      const cachedReview = await RedisCacheService.getCachedReview(cacheKey);
      if (cachedReview) {
        console.log(`[review-repo] Redis Cache HIT for key: ${cacheKey}. Returning cached review.`);
        const startTime = Date.now();
        // Emit progress so UI thinks it started
        progressEmitter.emit(`progress-${repositoryId}`, 'Cache HIT - Returning instantaneous review result...');
        
        // Minor delay to let UI show the status briefly
        await new Promise(r => setTimeout(r, 500));
        
        console.log(`[review-repo] Cache Response Time: ${Date.now() - startTime}ms`);
        
        // Save the cached review to MongoDB for the new repository so the history API can find it
        try {
          const ReviewHistory = require('../models/ReviewHistory');
          const reviewHistory = new ReviewHistory({
            repositoryId: repo._id,
            userId: req.userId,
            language: cachedReview.language,
            commitHash: cachedReview.commitHash,
            reviewData: cachedReview.reviewData,
            qualityScore: cachedReview.qualityScore,
            analyzerResults: cachedReview.analyzerResults,
          });
          await reviewHistory.save();
          await Repository.findByIdAndUpdate(repo._id, { qualityScore: cachedReview.qualityScore });
        } catch (dbErr) {
          console.error('[review-repo] Failed to save cached review to MongoDB:', dbErr);
        }

        return res.json({ message: 'Full repository review complete (Cached)', review: cachedReview });
      } else {
        console.log(`[review-repo] Redis Cache MISS for key: ${cacheKey}`);
      }
    }

    // ── Run the full pipeline ─────────────────────────────────────────────────
    let pipelineResult;
    const reviewStartTime = Date.now();
    try {
      pipelineResult = await runFullReviewPipeline({
        repositoryId,
        storagePath,
        repoName:  repo.name,
        openai,
        options:   { maxFiles: 50 },
      });
    } catch (pipelineErr) {
      console.error('[review-repo] Pipeline error:', pipelineErr.message);

      // Auth error passthrough
      if (pipelineErr.message.includes('401') || pipelineErr.message.includes('403') || pipelineErr.message.includes('404')) {
        return res.status(401).json({
          message: `Groq API Configuration Error: ${pipelineErr.message}`,
        });
      }

      // Rate-limit passthrough
      if (pipelineErr.status === 429 || (pipelineErr.message || '').includes('429')) {
        return res.status(429).json({
          message: 'AI API Quota Exceeded (429). Please check your Groq API limits or try again later.',
        });
      }

      return res.status(500).json({
        message: `Pipeline failed: ${pipelineErr.message}`,
      });
    }

    const { report, primaryLanguage, analyzerResults, filesReviewed } = pipelineResult;

    // ── Persist to ReviewHistory ──────────────────────────────────────────────
    const reviewData = {
      score:          report.qualityScore,
      summary:        report.summary,
      securityIssues: report.securityIssues,
      suggestions:    report.suggestions,
      filesReviewed:  report.filesReviewed,
    };

    const reviewHistory = new ReviewHistory({
      repositoryId,
      userId:              req.userId,
      workspaceId:         workspace ? workspace.workspaceId : null,
      repositoryType:      workspace ? workspace.repositoryType : (repo.url === 'uploaded-zip' ? 'zip' : 'github'),
      language:            primaryLanguage,
      commitHash:          'FULL_REPO_REVIEW',
      reviewData,
      qualityScore:        report.qualityScore,
      analyzerResults:     (analyzerResults || []).slice(0, 500),
    });

    await reviewHistory.save();
    console.log(`[review-repo] Saved ReviewHistory to MongoDB for repo "${repo.name}" (score: ${report.qualityScore})`);

    // ── Save to Redis Cache ───────────────────────────────────────────────────
    if (cacheKey) {
      await RedisCacheService.saveReviewToCache(cacheKey, reviewHistory.toObject());
      console.log(`[review-repo] Saved ReviewHistory to Redis: ${cacheKey}`);
    }

    // Also update the top-level qualityScore on the Repository document
    await Repository.findByIdAndUpdate(repositoryId, { qualityScore: report.qualityScore });
    
    console.log(`[review-repo] Total Review Time: ${Date.now() - reviewStartTime}ms`);

    res.json({ message: 'Full repository review complete', review: reviewHistory });
  } catch (error) {
    console.error('Full repo review error:', error);
    res.status(500).json({ message: 'Internal server error during full repo review' });
  }
});

module.exports = router;
