const fs = require('fs').promises;
const path = require('path');

const LANGUAGE_EXTENSIONS = {
  '.js': 'JavaScript',
  '.jsx': 'React',
  '.ts': 'TypeScript',
  '.tsx': 'React (TS)',
  '.py': 'Python',
  '.java': 'Java',
  '.c': 'C',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.html': 'HTML',
  '.css': 'CSS',
  '.json': 'JSON',
  '.md': 'Markdown',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build',
  'coverage', '.next', '.cache', 'vendor',
  'bin', 'obj', 'target',
  '__pycache__', '.venv', 'venv', '.tox',
  '.gradle', '.mvn', 'out', 'tmp', '.tmp',
]);

/**
 * Parses a directory and returns a nested tree structure.
 * @param {string} dirPath - Absolute path to directory
 * @param {string} rootPath - Absolute path to the root (used to calculate relative paths)
 * @param {Object} stats - Tracks accumulated size and count { size: 0, count: 0 }
 * @returns {Promise<Object>} Tree structure
 */
async function parseDirectory(dirPath, rootPath = dirPath, stats = { size: 0, count: 0 }) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      const subTree = await parseDirectory(fullPath, rootPath, stats);
      children.push({
        type: 'directory',
        name: entry.name,
        path: relativePath,
        children: subTree,
      });
    } else {
      const fileStat = await fs.stat(fullPath);
      stats.count += 1;
      stats.size += fileStat.size;

      if (stats.count > 20000) {
        throw new Error('Repository limit exceeded: More than 20,000 files.');
      }
      if (stats.size > 500 * 1024 * 1024) { // 500 MB
        throw new Error('Repository limit exceeded: Extracted size is over 500MB.');
      }

      const ext = path.extname(entry.name).toLowerCase();
      children.push({
        type: 'file',
        name: entry.name,
        path: relativePath,
        language: LANGUAGE_EXTENSIONS[ext] || 'Unknown',
        extension: ext,
      });
    }
  }

  // Sort: directories first, then files alphabetically
  const sortedChildren = children.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === 'directory' ? -1 : 1;
  });

  if (dirPath === rootPath) {
    console.log(`[repoParser] Parsed directory ${rootPath}: ${stats.count} files, ${(stats.size / 1024 / 1024).toFixed(2)} MB total size.`);
  }

  return sortedChildren;
}

/**
 * Calculates language statistics from the parsed tree.
 */
function calculateLanguageStats(tree) {
  const stats = {};
  
  const traverse = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'file' && node.language && node.language !== 'Unknown') {
        stats[node.language] = (stats[node.language] || 0) + 1;
      } else if (node.type === 'directory') {
        traverse(node.children);
      }
    }
  };
  
  traverse(tree);
  return stats;
}

module.exports = {
  parseDirectory,
  calculateLanguageStats,
};
