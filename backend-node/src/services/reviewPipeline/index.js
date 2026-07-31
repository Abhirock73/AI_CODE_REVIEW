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

// Global event emitter for streaming progress to the frontend SSE
const progressEmitter = new EventEmitter();
// Increase listener limit to prevent warnings during high concurrent usage
progressEmitter.setMaxListeners(100);

const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

async function callGroq(openai, prompt) {
  let lastError = null;
  let criticalError = null;
  const MODEL_CANDIDATES = [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-specdec',
    'llama3-8b-8192'
  ];
  for (const modelName of MODEL_CANDIDATES) {
    try {
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      });
      const text = response.choices[0].message.content.trim();
      return { text, modelName };
    } catch (err) {
      console.warn(`⚠️  [Pipeline] Groq model "${modelName}" failed: ${err.message}`);
      if (err.status === 429 || err.status === 401 || err.status === 403 || (err.message || '').includes('429') || (err.message || '').includes('quota') || (err.message || '').includes('401')) {
        criticalError = err;
      }
      lastError = err;
    }
  }
  if (criticalError) throw criticalError;
  throw lastError;
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
      const { text, modelName } = await callGroq(openai, prompt);
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
      console.error(`  ❌ LLM failed for "${file.relativePath}" chunk ${chunk.chunkIndex}: ${err.message}`);
      
      // Fatal Authentication/Configuration Errors
      if (err.status === 401 || err.status === 403 || err.status === 404 || (err.message || '').includes('401') || (err.message || '').includes('403') || (err.message || '').includes('404')) {
        throw new Error(`API Key / Model Configuration Error (401/403/404): ${err.message}`);
      }

      // Rate Limiting
      if (err.status === 429 || (err.message || '').includes('429')) {
        console.warn('[Pipeline] Rate limit hit — stopping LLM calls.');
        emitProgress('Rate limit hit, generating partial report...');
        rateLimited = true;
      }
    }
  });

  await processInParallel(aiTasks, concurrency);

  // Fallback if LLM failed
  if (chunkResults.length === 0) {
    throw new Error('Pipeline failed: No valid LLM results obtained. Your API key might be invalid, quota exceeded, or models unavailable in your region. Check backend logs for exact details.');
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
