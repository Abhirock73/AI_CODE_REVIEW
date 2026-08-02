const fs = require('fs').promises;
const path = require('path');
const JSZip = require('jszip');
const Repository = require('../models/Repository');
const { parseDirectory, calculateLanguageStats } = require('../utils/repoParser');

const os = require('os');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/workspaces';

/**
 * StorageService provides an abstraction over workspace storage (tmp_workspace)
 * for project and file operations.
 */
class StorageService {
  /**
   * Helper method to resolve absolute project directory path from DB or workspace fallback.
   * @private
   */
  static async _getProjectDir(projectId) {
    let projectDir = null;
    let repo = null;

    if (projectId && typeof projectId !== 'string' && projectId.toString) {
      projectId = projectId.toString();
    }

    try {
      if (typeof projectId === 'string' && projectId.match(/^[0-9a-fA-F]{24}$/)) {
        repo = await Repository.findById(projectId);
      }
    } catch (e) {
      // Ignore database connection error for fallback/test environments
    }

    if (repo && repo.metadata && repo.metadata.storagePath) {
      projectDir = repo.metadata.storagePath;
    } else if (typeof projectId === 'string') {
      if (path.isAbsolute(projectId)) {
        projectDir = projectId;
      } else {
        projectDir = path.join(WORKSPACE_DIR, projectId);
      }
    }

    if (!projectDir) {
      throw new Error(`Project directory not found for ID: ${projectId}`);
    }

    // Ensure directory exists
    await fs.mkdir(projectDir, { recursive: true });
    return { projectDir, repo };
  }

  /**
   * Helper method to sanitize relative paths and prevent directory traversal.
   * @private
   */
  static _sanitizePath(projectDir, relativePath) {
    if (!relativePath) return projectDir;

    // Reject absolute paths and directory traversal attempts explicitly
    if (path.isAbsolute(relativePath) || relativePath.includes('../') || relativePath.includes('..\\')) {
      throw new Error('Access denied: Invalid file path traversal');
    }

    const safePath = path.normalize(relativePath).replace(/^(\.\.([/\\]|$))+/, '');
    const resolvedPath = path.join(projectDir, safePath);
    if (!resolvedPath.startsWith(path.resolve(projectDir))) {
      throw new Error('Access denied: Invalid file path traversal outside workspace');
    }
    return resolvedPath;
  }

  /**
   * Get project metadata, tree structure, and language stats. Ignores node_modules.
   * @param {string} projectId 
   */
  static async getProject(projectId) {
    const { projectDir, repo } = await StorageService._getProjectDir(projectId);
    const tree = await parseDirectory(projectDir);
    const languageStats = calculateLanguageStats(tree);

    if (repo) {
      repo.metadata = repo.metadata || {};
      repo.metadata.tree = tree;
      repo.metadata.languageStats = languageStats;
      await repo.save();
    }

    return {
      projectId,
      storagePath: projectDir,
      repository: repo,
      tree,
      languageStats,
    };
  }

  /**
   * Read raw file content from project.
   * @param {string} projectId 
   * @param {string} filePath 
   */
  static async readFile(projectId, filePath) {
    const { projectDir } = await StorageService._getProjectDir(projectId);
    const absolutePath = StorageService._sanitizePath(projectDir, filePath);
    const content = await fs.readFile(absolutePath, 'utf8');
    return content;
  }

  /**
   * Write or update content in a file.
   * @param {string} projectId 
   * @param {string} filePath 
   * @param {string|Buffer} content 
   */
  static async writeFile(projectId, filePath, content) {
    const { projectDir } = await StorageService._getProjectDir(projectId);
    const absolutePath = StorageService._sanitizePath(projectDir, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
    return { success: true, filePath, absolutePath };
  }

  /**
   * Delete a file or directory from the project.
   * @param {string} projectId 
   * @param {string} filePath 
   */
  static async deleteFile(projectId, filePath) {
    const { projectDir } = await StorageService._getProjectDir(projectId);
    const absolutePath = StorageService._sanitizePath(projectDir, filePath);
    await fs.rm(absolutePath, { recursive: true, force: true });
    return { success: true, filePath };
  }

  /**
   * Create a file with content (defaults to empty string).
   * @param {string} projectId 
   * @param {string} filePath 
   * @param {string} content 
   */
  static async createFile(projectId, filePath, content = '') {
    const { projectDir } = await StorageService._getProjectDir(projectId);
    const absolutePath = StorageService._sanitizePath(projectDir, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
    return { success: true, filePath, absolutePath };
  }

  /**
   * Create a directory folder in the project.
   * @param {string} projectId 
   * @param {string} folderPath 
   */
  static async createFolder(projectId, folderPath) {
    const { projectDir } = await StorageService._getProjectDir(projectId);
    const absolutePath = StorageService._sanitizePath(projectDir, folderPath);
    await fs.mkdir(absolutePath, { recursive: true });
    return { success: true, folderPath, absolutePath };
  }

  /**
   * Rename or move a file/folder in the project.
   * @param {string} projectId 
   * @param {string} oldPath 
   * @param {string} newPath 
   */
  static async rename(projectId, oldPath, newPath) {
    const { projectDir } = await StorageService._getProjectDir(projectId);
    const absoluteOldPath = StorageService._sanitizePath(projectDir, oldPath);
    const absoluteNewPath = StorageService._sanitizePath(projectDir, newPath);

    await fs.mkdir(path.dirname(absoluteNewPath), { recursive: true });
    await fs.rename(absoluteOldPath, absoluteNewPath);
    return { success: true, oldPath, newPath };
  }

  /**
   * Archive all project files into a ZIP buffer, ignoring specified folders.
   * @param {string} projectId 
   * @returns {Promise<Buffer>} ZIP file buffer
   */
  static async zipProject(projectId) {
    console.log(`[StorageService] Zipping project ${projectId}...`);
    const { projectDir } = await StorageService._getProjectDir(projectId);
    let zip = new JSZip();
    const EXCLUDES = ['.git', 'node_modules', '.cache', 'dist', 'build', 'coverage', 'tmp', 'logs'];

    try {
      const addDirectoryToZip = async (currentDir, rootDir) => {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (EXCLUDES.includes(entry.name)) continue;

          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            await addDirectoryToZip(fullPath, rootDir);
          } else {
            const fileContent = await fs.readFile(fullPath);
            zip.file(relativePath, fileContent);
          }
        }
      };

      await addDirectoryToZip(projectDir, projectDir);
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      console.log(`[StorageService] Successfully zipped project ${projectId}. Size: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      return zipBuffer;
    } catch (err) {
      console.error(`[StorageService] Failed to zip project ${projectId}:`, err);
      throw err;
    } finally {
      zip = null; // Suggest garbage collection for the zip instance
    }
  }

  /**
   * Archive project files and stream directly to a physical file on disk.
   * @param {string} projectId 
   * @param {string} outputPath 
   * @returns {Promise<void>} Resolves when write is complete
   */
  static async createZipFile(projectId, outputPath) {
    console.log(`[StorageService] Creating physical ZIP for project ${projectId} at ${outputPath}...`);
    const { projectDir } = await StorageService._getProjectDir(projectId);
    let zip = new JSZip();
    const EXCLUDES = ['.git', 'node_modules', '.cache', 'dist', 'build', 'coverage', 'tmp', 'logs'];

    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const addDirectoryToZip = async (currentDir, rootDir) => {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (EXCLUDES.includes(entry.name)) continue;

          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            await addDirectoryToZip(fullPath, rootDir);
          } else {
            // Using streams for files prevents loading everything into memory at once
            zip.file(relativePath, require('fs').createReadStream(fullPath));
          }
        }
      };

      await addDirectoryToZip(projectDir, projectDir);

      return new Promise((resolve, reject) => {
        const writeStream = require('fs').createWriteStream(outputPath);
        zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
          .pipe(writeStream)
          .on('finish', () => resolve())
          .on('error', (err) => reject(err));
      });
    } catch (err) {
      console.error(`[StorageService] Failed to create ZIP file for project ${projectId}:`, err);
      throw err;
    } finally {
      zip = null;
    }
  }
}

module.exports = StorageService;
