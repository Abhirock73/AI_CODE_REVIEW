'use strict';
/**
 * Result Aggregator
 * ─────────────────────────────────────────────────────────────────────────────
 * Merges every per-chunk, per-file LLM response into a single repository-level
 * report matching the schema: { qualityScore, securityIssues, suggestions, summary }
 */

/**
 * Clamp a value to [0, 100].
 */
function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Safe average of an array of numbers, ignoring null/undefined.
 */
function safeAvg(arr) {
  const valid = arr.filter(v => typeof v === 'number' && !isNaN(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Merges all chunk results into a final report.
 */
function aggregateResults(chunkResults, repoName = '', totalFilesScanned = 0) {
  if (!chunkResults.length) {
    return {
      qualityScore: 0,
      summary: 'No files were successfully reviewed.',
      securityIssues: [],
      suggestions: [],
      filesReviewed: 0,
    };
  }

  // ── Aggregation ───────────────────────────────────────────────────
  const scores = [];
  const allSecurityIssues = [];
  const allSuggestions = [];
  const filesReviewedSet = new Set();

  for (const cr of chunkResults) {
    filesReviewedSet.add(cr.filePath);
    if (typeof cr.qualityScore === 'number') scores.push(cr.qualityScore);

    if (Array.isArray(cr.securityIssues)) {
      allSecurityIssues.push(...cr.securityIssues.map(s => ({
        ...s,
        file: cr.filePath,
        severity: (s.severity || 'Medium').toString().charAt(0).toUpperCase() + (s.severity || 'Medium').toString().slice(1).toLowerCase()
      })));
    }

    if (Array.isArray(cr.suggestions)) {
      allSuggestions.push(...cr.suggestions.map(s => {
        if (typeof s === 'string') return { issue: s, file: cr.filePath };
        return { ...s, file: cr.filePath };
      }));
    }
  }

  // Deduplicate suggestions based on issue text to avoid spam
  const seenIssues = new Set();
  const uniqueSuggestions = [];
  for (const s of allSuggestions) {
    const key = s.issue || JSON.stringify(s);
    if (!seenIssues.has(key)) {
      seenIssues.add(key);
      uniqueSuggestions.push(s);
    }
  }

  const qualityScore = clamp(safeAvg(scores));
  const filesReviewed = filesReviewedSet.size;
  const highSec = allSecurityIssues.filter(s => s.severity === 'High').length;

  let summary = `Reviewed ${filesReviewed} of ${totalFilesScanned} files in ${repoName || 'repository'}`;
  if (highSec > 0) summary += ` — ${highSec} high-severity security issue(s) found`;
  summary += `. Overall quality score: ${qualityScore}/100.`;

  return {
    qualityScore,
    summary,
    securityIssues: allSecurityIssues,
    suggestions: uniqueSuggestions,
    filesReviewed,
  };
}

module.exports = { aggregateResults };
