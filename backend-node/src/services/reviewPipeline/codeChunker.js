'use strict';
/**
 * STEP 5 — Code Chunker
 * ─────────────────────────────────────────────────────────────────────────────
 * Splits file content into 400–600 line chunks. Tries to honour logical
 * boundaries (blank lines between top-level declarations) so classes and
 * functions are not torn apart mid-way.
 *
 * Each chunk carries:
 *   { chunkIndex, totalChunks, content, startLine, endLine, lineCount }
 */

const TARGET_MIN  = 400;   // minimum lines per chunk
const TARGET_MAX  = 600;   // maximum lines per chunk
const HARD_MAX    = 650;   // absolute ceiling before we force-split

/**
 * Finds a good split point near `idealLine` by scanning backwards for a blank
 * line, which often sits between top-level declarations.
 *
 * @param {string[]} lines
 * @param {number}   idealLine  – 0-indexed
 * @param {number}   searchBack – how many lines to scan back
 * @returns {number} best split line index (exclusive upper bound)
 */
function findSplitPoint(lines, idealLine, searchBack = 80) {
  const start = Math.max(idealLine - searchBack, 0);
  // Scan backwards from idealLine for a blank line
  for (let i = idealLine; i >= start; i--) {
    if (lines[i].trim() === '') return i + 1; // split after the blank line
  }
  // No blank line found — split at idealLine
  return idealLine;
}

/**
 * Splits the content of a single file into chunks.
 *
 * @param {string} content    – full file content
 * @param {string} filePath   – relative path (for debug logs only)
 * @returns {Chunk[]}
 *
 * @typedef {Object} Chunk
 * @property {number} chunkIndex
 * @property {number} totalChunks  – set after all chunks are collected
 * @property {string} content
 * @property {number} startLine    – 1-indexed
 * @property {number} endLine      – 1-indexed inclusive
 * @property {number} lineCount
 */
function chunkFile(content, filePath = '') {
  const lines = content.split('\n');
  const total = lines.length;

  // Short files — single chunk
  if (total <= TARGET_MAX) {
    return [{
      chunkIndex: 0,
      totalChunks: 1,
      content,
      startLine: 1,
      endLine: total,
      lineCount: total,
    }];
  }

  const chunks = [];
  let cursor   = 0; // current line index (0-based)

  while (cursor < total) {
    const remaining = total - cursor;

    // Last piece — take the rest
    if (remaining <= HARD_MAX) {
      const chunkLines = lines.slice(cursor);
      chunks.push({
        chunkIndex: chunks.length,
        totalChunks: 0, // filled in after loop
        content:    chunkLines.join('\n'),
        startLine:  cursor + 1,
        endLine:    total,
        lineCount:  chunkLines.length,
      });
      break;
    }

    // Find ideal end point
    const idealEnd  = cursor + TARGET_MIN + Math.floor((TARGET_MAX - TARGET_MIN) / 2);
    const splitAt   = findSplitPoint(lines, Math.min(idealEnd, total - 1));
    const chunkEnd  = Math.min(Math.max(splitAt, cursor + TARGET_MIN), cursor + HARD_MAX, total);

    const chunkLines = lines.slice(cursor, chunkEnd);
    chunks.push({
      chunkIndex: chunks.length,
      totalChunks: 0,
      content:    chunkLines.join('\n'),
      startLine:  cursor + 1,
      endLine:    cursor + chunkLines.length,
      lineCount:  chunkLines.length,
    });

    cursor = chunkEnd;
  }

  // Backfill totalChunks
  const n = chunks.length;
  for (const c of chunks) c.totalChunks = n;

  if (chunks.length > 1) {
    console.log(`[Chunker] "${filePath}" split into ${chunks.length} chunks (${total} lines)`);
  }

  return chunks;
}

/**
 * Chunks all files in the scanned list.
 * Files that are very small (≤ TARGET_MAX lines) become a single chunk.
 *
 * @param {import('./repoScanner').ScanResult[]} files
 * @param {Object}                               contents  – { relativePath: string }
 * @returns {FileChunks[]}
 *
 * @typedef {Object} FileChunks
 * @property {import('./repoScanner').ScanResult} file
 * @property {Chunk[]}                            chunks
 */
function chunkFiles(files, contents) {
  return files.map(file => ({
    file,
    chunks: chunkFile(contents[file.relativePath] || '', file.relativePath),
  }));
}

module.exports = { chunkFile, chunkFiles };
