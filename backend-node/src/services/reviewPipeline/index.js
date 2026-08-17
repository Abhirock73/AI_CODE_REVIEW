'use strict';
/**
 * Simple & Fast AI Review Pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 * Scanning -> Chunking -> AI Review -> Aggregation
 */

const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

const { scanRepository }        = require('./repoScanner');
const { chunkFile }             = require('./codeChunker');
const { buildPrompt }           = require('./llmPromptBuilder');
const { aggregateResults }      = require('./resultAggregator');
const { getCachedReview, cacheResult } = require('./reviewCache');

// ── Environment Variable Pre-flight ──────────────────────────────────────────
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GROQ_API_KEY && !GEMINI_API_KEY) {
  console.error(
    '[Pipeline] ❌ FATAL: Neither GROQ_API_KEY nor GEMINI_API_KEY is set in your environment. ' +
    'The review pipeline will fail. Please add at least one key to your .env file and restart the server.'
  );
} else {
  if (!GROQ_API_KEY) {
    console.warn('[Pipeline] ⚠️  GROQ_API_KEY is not set — Groq will be skipped; Gemini will be used as the primary provider.');
  }
  if (!GEMINI_API_KEY) {
    console.warn('[Pipeline] ⚠️  GEMINI_API_KEY is not set — Gemini fallback will not be available.');
  }
}

// ── Gemini Client (fallback) ──────────────────────────────────────────────────
let geminiClient = null;
if (GEMINI_API_KEY) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('[Pipeline] ✅ Gemini client initialised (fallback provider ready).');
  } catch (e) {
    console.error('[Pipeline] ❌ Failed to initialise Gemini client:', e.message);
  }
}

// Global event emitter for streaming progress to the frontend SSE
const progressEmitter = new EventEmitter();
// Increase listener limit to prevent warnings during high concurrent usage
progressEmitter.setMaxListeners(100);

// ── Model candidate lists ─────────────────────────────────────────────────────
const GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-specdec',
  'llama3-8b-8192',
];

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

// ── Rich error logger ─────────────────────────────────────────────────────────
/**
 * Logs every available detail from an LLM SDK error so that the root cause
 * (401, 429, region block, etc.) is visible in the terminal.
 */
function logLLMError(provider, modelName, err) {
  const status  = err.status  ?? err.statusCode  ?? err.code ?? 'unknown';
  const headers = err.headers ?? err.response?.headers ?? {};
  const body    = err.error   ?? err.body         ?? err.data ?? null;
  const retryAfter = headers['retry-after'] ?? headers['x-ratelimit-reset-requests'] ?? null;

  console.error(`\n${'─'.repeat(60)}`);
  console.error(`❌ [${provider}] Model "${modelName}" API call FAILED`);
  console.error(`   HTTP Status  : ${status}`);
  console.error(`   Error Msg   : ${err.message}`);
  if (retryAfter) {
    console.error(`   Retry-After : ${retryAfter}`);
  }
  if (Object.keys(headers).length) {
    // Only print the most useful headers
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
  }
  if (body) {
    console.error(`   Provider Error Body:`, typeof body === 'object' ? JSON.stringify(body, null, 2) : body);
  }
  console.error(`${'─'.repeat(60)}\n`);
}

// ── callGroqModels ────────────────────────────────────────────────────────────
/**
 * Tries each Groq model candidate in order.
 * Returns { text, modelName } on success, throws the last error on full failure.
 * Sets `isRateLimit = true` on the thrown error if the failure was a 429.
 */
async function callGroqModels(openai, prompt) {
  let lastError = null;

  for (const modelName of GROQ_MODELS) {
    try {
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      const text = response.choices[0].message.content.trim();
      console.log(`✅ [Groq] Model "${modelName}" succeeded.`);
      return { text, modelName };
    } catch (err) {
      logLLMError('Groq', modelName, err);

      // Auth errors: no point retrying any model
      if (err.status === 401 || err.status === 403) {
        err.isFatal = true;
        throw err;
      }

      // Rate limit: mark and stop trying Groq models — caller will try Gemini
      if (err.status === 429 || (err.message || '').includes('429')) {
        err.isRateLimit = true;
        throw err;
      }

      lastError = err;
    }
  }

  // All Groq models exhausted for non-fatal/non-429 reasons
  throw lastError;
}

// ── callGeminiModels ──────────────────────────────────────────────────────────
/**
 * Tries each Gemini model candidate in order.
 * Returns { text, modelName } on success, throws the last error on full failure.
 */
async function callGeminiModels(prompt) {
  if (!geminiClient) {
    throw new Error('Gemini client is not initialised (GEMINI_API_KEY missing or invalid).');
  }

  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(`🟡 [Gemini] Trying model "${modelName}"...`);
      const model  = geminiClient.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text   = result.response.text().trim();
      console.log(`✅ [Gemini] Model "${modelName}" succeeded.`);
      return { text, modelName: `gemini/${modelName}` };
    } catch (err) {
      logLLMError('Gemini', modelName, err);

      if (err.status === 401 || err.status === 403) {
        err.isFatal = true;
        throw err;
      }

      lastError = err;
    }
  }

  throw lastError;
}

// ── callLLM ───────────────────────────────────────────────────────────────────
/**
 * Primary entry point for LLM calls in the pipeline.
 * 1. Tries Groq (if openai client is provided)
 * 2. Falls back to Gemini on 429 or full Groq exhaustion
 */
async function callLLM(openai, prompt) {
  // If Groq is configured, attempt it first
  if (openai) {
    try {
      return await callGroqModels(openai, prompt);
    } catch (groqErr) {
      if (groqErr.isFatal) {
        // Auth error — surface immediately, don't bother Gemini
        throw groqErr;
      }

      if (groqErr.isRateLimit) {
        console.warn('[Pipeline] ⚠️  Groq rate-limited (429). Falling back to Gemini...');
      } else {
        console.warn(`[Pipeline] ⚠️  All Groq models failed (${groqErr.message}). Falling back to Gemini...`);
      }
    }
  }

  // Gemini fallback
  return await callGeminiModels(prompt);
}

function parseResponse(text, filePath, chunkIndex) {
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  else if (clean.startsWith('```'))  clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');

  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error(`[parseResponse] ❌ No JSON object found in response for ${filePath} chunk ${chunkIndex}. Raw response:\n${text}`);
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch (e) {
    console.error(`[parseResponse] ❌ JSON parsing failed for ${filePath} chunk ${chunkIndex}. Error: ${e.message}\nRaw JSON match:\n${match[0]}`);
    return null;
  }
}

async function processInParallel(tasks, concurrency) {
  const results = [];
  const executing = new Set();
  
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Runs the simple AI review pipeline.
 */
async function runFullReviewPipeline({ repositoryId, storagePath, repoName, openai, options = {} }) {
  const {
    maxFiles    = 50,
    concurrency = 3,
  } = options;

  const emitProgress = (msg) => {
    console.log(`[Pipeline] ${msg}`);
    if (repositoryId) {
      progressEmitter.emit(`progress-${repositoryId}`, msg);
    }
  };

  const totalStartTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 [Pipeline] Starting simplified review for "${repoName}" at ${storagePath}`);
  console.log(`${'='.repeat(60)}`);

  // Step 1: Scanning Repository
  emitProgress('Scanning Repository...');
  const allFiles = await scanRepository(storagePath);
  if (allFiles.length === 0) {
    emitProgress('Failed: No source files found.');
    throw new Error('No source files found in repository after scanning.');
  }

  // Step 2: Building Chunks
  emitProgress('Building Chunks...');
  const filesToReview = allFiles.slice(0, maxFiles);

  const contents = {};
  for (const file of filesToReview) {
    try {
      contents[file.relativePath] = await fs.readFile(file.absolutePath, 'utf8');
    } catch (err) {
      console.warn(`[Pipeline] Could not read "${file.relativePath}": ${err.message}`);
    }
  }

  const allChunks = [];
  for (const file of filesToReview) {
    const content = contents[file.relativePath];
    if (!content) continue;
    const chunks = chunkFile(content, file.relativePath);
    for (const chunk of chunks) {
      allChunks.push({ file, chunk });
    }
  }

  const totalChunks = allChunks.length;
  emitProgress(`Analyzing ${totalChunks} chunks with AI...`);

  // Step 3: Analyzing with AI
  const chunkResults = [];
  let rateLimited = false;
  let completedChunks = 0;
  let lastLLMError = null;

  const aiTasks = allChunks.map(({ file, chunk }) => async () => {
    if (rateLimited) return;

    // Check cache
    const cached = await getCachedReview(chunk.content, file.language || 'Unknown');
    if (cached) {
      chunkResults.push({ ...cached, filePath: file.relativePath });
      completedChunks++;
      if (completedChunks % 5 === 0) {
         emitProgress(`Analyzed ${completedChunks} / ${totalChunks} chunks...`);
      }
      return;
    }

    const ctx = {
      filePath: file.relativePath,
      language: file.language || 'Unknown',
      chunkContent: chunk.content,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      repoName: repoName
    };

    const prompt = buildPrompt(ctx);

    try {
      const { text, modelName } = await callLLM(openai, prompt);
      const parsed = parseResponse(text, file.relativePath, chunk.chunkIndex);

      if (parsed) {
        const result = {
          filePath:             file.relativePath,
          qualityScore:         parsed.qualityScore         || 70,
          summary:              parsed.summary              || '',
          securityIssues:       Array.isArray(parsed.securityIssues) ? parsed.securityIssues : (parsed.securityIssues ? [parsed.securityIssues] : []),
          suggestions:          Array.isArray(parsed.suggestions)    ? parsed.suggestions    : (parsed.suggestions ? [parsed.suggestions] : []),
          startLine:            chunk.startLine,
          endLine:              chunk.endLine,
        };

        await cacheResult(chunk.content, file.language || 'Unknown', result);
        chunkResults.push(result);
        
        completedChunks++;
        if (completedChunks % 5 === 0) {
          emitProgress(`Analyzed ${completedChunks} / ${totalChunks} chunks...`);
        }
      }
    } catch (err) {
      lastLLMError = err;
      console.error(`  ❌ LLM (all providers) failed for "${file.relativePath}" chunk ${chunk.chunkIndex}: ${err.message}`);
      
      // Fatal Authentication/Configuration Errors — surface immediately
      if (err.isFatal || err.status === 401 || err.status === 403 || err.status === 404) {
        throw new Error(`API Key / Model Configuration Error (${err.status ?? 'fatal'}): ${err.message}`);
      }

      // Rate Limiting — stop further calls, report partial results
      if (err.status === 429 || (err.message || '').includes('429')) {
        console.warn('[Pipeline] Both Groq and Gemini are rate-limited — stopping LLM calls.');
        emitProgress('Both providers rate-limited, generating partial report...');
        rateLimited = true;
      }
    }
  });

  await processInParallel(aiTasks, concurrency);

  // Fallback if ALL LLM calls failed — include root cause in the message
  if (chunkResults.length === 0) {
    const rootCause = lastLLMError
      ? `Root cause: [${lastLLMError.status ?? lastLLMError.code ?? 'unknown status'}] ${lastLLMError.message}`
      : 'No LLM error detail captured — check logs above.';
    throw new Error(
      `Pipeline failed: No valid LLM results obtained. ${rootCause} ` +
      '(Possible causes: invalid API key, quota exceeded, or region restriction. See backend terminal for full HTTP details.)'
    );
  }

  // Step 4: Generating Final Report
  emitProgress('Generating Final Report...');
  const report = aggregateResults(
    chunkResults,
    repoName,
    allFiles.length,
  );

  if (rateLimited) {
    report.summary = `[Partial] Rate limit reached. ${report.summary}`;
  }

  const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
  emitProgress(`Done in ${totalTime}s`);

  return {
    report,
    primaryLanguage: 'Unknown',
    analyzerResults: [],
    filesScanned:    allFiles.length,
    filesReviewed:   report.filesReviewed,
    cacheHits:       0,
  };
}

module.exports = { runFullReviewPipeline, progressEmitter };
