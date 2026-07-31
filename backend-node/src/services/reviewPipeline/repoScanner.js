'use strict';
/**
 * STEP 1 — Repository Scanner
 * ─────────────────────────────────────────────────────────────────────────────
 * Recursively scans a project directory and returns only source files that are
 * relevant for AI review. Skips generated dirs, binary assets, and lock files.
 */

const fs   = require('fs').promises;
const path = require('path');

// ── Directories to skip ──────────────────────────────────────────────────────
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build',
  'coverage', '.next', '.cache', 'vendor',
  'bin', 'obj', 'target',
  '__pycache__', '.venv', 'venv', '.tox',
  '.gradle', '.mvn', 'out', 'tmp', '.tmp',
  '.idea', '.vscode', '.DS_Store',
]);

// ── Binary / media file extensions to skip ───────────────────────────────────
const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib',
  '.class', '.jar', '.war', '.ear',
  '.pyc', '.pyo', '.pyd',
  '.o', '.obj', '.out',
  '.wasm', '.map',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.mp3', '.mp4', '.wav', '.avi', '.mkv',
  '.db', '.sqlite', '.sqlite3',
]);

// ── Lock files to skip ───────────────────────────────────────────────────────
const IGNORE_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
  'Gemfile.lock',
  'composer.lock',
  '.eslintcache',
  '.stylelintcache',
  'shrinkwrap.json',
]);

// ── Language map (extension → display name) ───────────────────────────────────
const LANGUAGE_MAP = {
  '.js':   'JavaScript',
  '.jsx':  'JavaScript',
  '.mjs':  'JavaScript',
  '.cjs':  'JavaScript',
  '.ts':   'TypeScript',
  '.tsx':  'TypeScript',
  '.mts':  'TypeScript',
  '.py':   'Python',
  '.java': 'Java',
  '.c':    'C',
  '.h':    'C',
  '.cpp':  'C++',
  '.cc':   'C++',
  '.cxx':  'C++',
  '.hpp':  'C++',
  '.cs':   'C#',
  '.go':   'Go',
  '.rs':   'Rust',
  '.rb':   'Ruby',
  '.php':  'PHP',
  '.swift':'Swift',
  '.kt':   'Kotlin',
  '.scala':'Scala',
  '.sh':   'Shell',
  '.bash': 'Shell',
  '.zsh':  'Shell',
  '.html': 'HTML',
  '.css':  'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
  '.less': 'CSS',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml':  'YAML',
  '.toml': 'TOML',
  '.xml':  'XML',
  '.sql':  'SQL',
  '.md':   'Markdown',
  '.graphql': 'GraphQL',
  '.gql':  'GraphQL',
  '.env':  'Config',
  '.ini':  'Config',
  '.cfg':  'Config',
};

/**
 * Scans a repository directory recursively.
 *
 * @param {string} dirPath   – Absolute path to the repository root
 * @param {string} [rootPath] – Used internally for relative-path calculation
 * @returns {Promise<ScanResult[]>}
 *
 * @typedef {Object} ScanResult
 * @property {string} absolutePath
 * @property {string} relativePath
 * @property {string} name
 * @property {string} extension
 * @property {string} language
 * @property {number} sizeBytes
 */
async function scanRepository(dirPath, rootPath = dirPath, stats = { scanned: 0, ignored: 0 }) {
  const results = [];

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`[RepoScanner] Cannot read dir "${dirPath}": ${err.message}`);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        stats.ignored++;
        continue;
      }
      // Recurse
      const nested = await scanRepository(fullPath, rootPath, stats);
      results.push(...nested);
    } else if (entry.isFile()) {
      stats.scanned++;
      const name      = entry.name;
      const ext       = path.extname(name).toLowerCase();
      const lang      = LANGUAGE_MAP[ext];

      // Skip binary / lock / unrecognised files
      if (IGNORE_EXTENSIONS.has(ext)) { stats.ignored++; continue; }
      if (IGNORE_FILENAMES.has(name)) { stats.ignored++; continue; }
      // Skip files with no known language extension (e.g. .log, .txt, etc.)
      // but keep config-like files that have a known mapping
      if (!lang) { stats.ignored++; continue; }

      let sizeBytes = 0;
      try {
        const stat = await fs.stat(fullPath);
        sizeBytes = stat.size;
      } catch { /* ignore stat failures */ }

      const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

      results.push({
        absolutePath: fullPath,
        relativePath,
        name,
        extension: ext,
        language: lang,
        sizeBytes,
      });
    }
  }

  // If this is the root directory, log the final stats
  if (dirPath === rootPath) {
    console.log('[RepoScanner] Scanning Repository...');
    console.log(`[RepoScanner] Files scanned: ${stats.scanned}`);
    console.log(`[RepoScanner] Files ignored: ${stats.ignored}`);
    console.log(`[RepoScanner] Total source files: ${results.length}`);
  }

  return results;
}

module.exports = { scanRepository };
