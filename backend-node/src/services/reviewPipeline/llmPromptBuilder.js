'use strict';
/**
 * STEP 2 — LLM Prompt Builder
 * ─────────────────────────────────────────────────────────────────────────────
 * Constructs the structured prompt sent to Gemini for each file chunk.
 */

/**
 * Builds the LLM prompt for a single file chunk.
 */
function buildPrompt(ctx) {
  const {
    filePath,
    language,
    chunkContent,
    chunkIndex,
    totalChunks,
    startLine,
    endLine,
    repoName,
  } = ctx;

  const isMultiChunk = totalChunks > 1;
  const chunkLabel = isMultiChunk
    ? `(chunk ${chunkIndex + 1} of ${totalChunks}, lines ${startLine}–${endLine})`
    : `(${endLine} lines)`;

  return `You are an expert senior software engineer performing a rigorous code review.

## Repository: ${repoName}
## Current File: ${filePath} ${chunkLabel}
## Language: ${language}

## Code to Review:
\`\`\`${language.toLowerCase()}
${chunkContent}
\`\`\`

## Task
Review the code above for:
1. Security vulnerabilities (injections, hardcoded secrets, eval, XSS, CSRF, IDOR, etc.)
2. Code smells
3. Performance issues (N+1 queries, blocking calls, memory leaks, infinite loops)
4. Maintainability issues (coupling, duplication, single responsibility)
5. Best practice violations (language idioms, error handling, logging)
6. Improvement suggestions

CRITICAL INSTRUCTION: You must actively look for and flag Security Vulnerabilities (e.g., injection flaws, unvalidated inputs, hardcoded secrets, eval usage, insecure configurations). Do not be lenient. If the code has ANY security risk, you MUST report it in the \`securityIssues\` array using the exact schema below.

Return ONLY valid JSON — no markdown fences, no text outside JSON — matching this schema exactly:
{
  "qualityScore": <integer 0-100>,
  "securityIssues": [
    {
       "severity": "High|Medium|Low",
       "file": "${filePath}",
       "line": <integer or null>,
       "title": "<Short Issue Title>",
       "description": "<Detailed description>",
       "recommendation": "<How to fix it>"
    }
  ],
  "suggestions": [
    "<string: actionable suggestion 1>",
    "<string: actionable suggestion 2>"
  ],
  "summary": "<Repository/Chunk Summary: one sentence overall assessment>"
}`;
}

/**
 * Builds a lightweight single-file prompt (used by /api/ai/review-file).
 */
function buildSingleFilePrompt(code, language, filename) {
  return `You are an expert senior software engineer performing a rigorous and highly critical code review.

Analyze the following ${language} code from the file \`${filename}\` and return a structured JSON response ONLY (no markdown fences, no explanation outside JSON).

CRITICAL INSTRUCTION: You must actively look for and flag the following:
1. Logic Bugs (e.g., infinite loops, off-by-one errors, unreachable code).
2. Security Vulnerabilities (e.g., injection flaws, unvalidated inputs, denial of service risks like infinite loops).
3. Code Quality Issues (e.g., poor variable naming, lack of modularity).

Do not be lenient. If the code has a blatant logic error like an infinite loop, you MUST report it.

The JSON must conform to exactly this schema:
{
  "qualityScore": <integer 0-100>,
  "securityIssues": [
    {
       "severity": "High|Medium|Low",
       "file": "${filename}",
       "line": <integer or null>,
       "title": "<Short Issue Title>",
       "description": "<Detailed description>",
       "recommendation": "<How to fix it>"
    }
  ],
  "suggestions": [
    "<string>"
  ],
  "summary": "<one-sentence overall assessment>"
}

Code to review:
\`\`\`${language}
${code.slice(0, 100000)}
\`\`\``;
}

module.exports = { buildPrompt, buildSingleFilePrompt };
