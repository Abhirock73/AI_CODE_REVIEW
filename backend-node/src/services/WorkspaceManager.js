const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const os = require('os');
const JSZip = require('jszip');
const simpleGit = require('simple-git');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const Workspace = require('../models/Workspace');
const Repository = require('../models/Repository');
const StorageService = require('./StorageService');
const { setCache, delCache } = require('./redisCache');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/workspaces';

class WorkspaceManager {
  /**
   * Initializes the workspace directory and performs cleanup of orphaned folders.
   */
  static async init() {
    try {
      await fs.mkdir(WORKSPACE_DIR, { recursive: true });
      
      // Cleanup orphan directories on startup
      console.log(`[WorkspaceManager] Scanning for orphan workspaces...`);
      const directories = await fs.readdir(WORKSPACE_DIR, { withFileTypes: true });
      
      let orphansDeleted = 0;
      for (const dirent of directories) {
        if (!dirent.isDirectory()) continue;
        
        const folderName = dirent.name;
        const activeWorkspace = await Workspace.findOne({ workspaceId: folderName });
        
        if (!activeWorkspace) {
          const folderPath = path.join(WORKSPACE_DIR, folderName);
          console.log(`[WorkspaceManager] Deleting orphan workspace directory: ${folderName}`);
          try {
             await fs.rm(folderPath, { recursive: true, force: true });
             orphansDeleted++;
          } catch (e) {
             console.error(`[WorkspaceManager] Failed to delete orphan directory ${folderName}`, e);
          }
        }
      }
      
      if (orphansDeleted > 0) {
        console.log(`[WorkspaceManager] Cleanup complete. Deleted ${orphansDeleted} orphan directories.`);
      }
    } catch (err) {
      console.error('Failed to initialize or cleanup global workspace directory', err);
    }
  }

  /**
   * Creates a new workspace for a repository
   */
  static async createWorkspace(repositoryId, repositoryType, ownerId) {
    const workspaceId = crypto.randomUUID();
    const repositoryPath = path.join(WORKSPACE_DIR, workspaceId);

    console.log(`[WorkspaceManager] Creating workspace ${workspaceId} for repo ${repositoryId}`);
    
    // The directory will be actually created by the caller (ZIP extraction or Git clone),
    // but we can ensure the parent exists just in case.
    await this.init();

    const workspace = new Workspace({
      workspaceId,
      repositoryId,
      repositoryType,
      ownerId,
      repositoryPath,
      lastActivity: new Date(),
      status: 'ACTIVE'
    });

    await workspace.save();

    // Save workspace metadata to Redis with 30 minute TTL (1800s)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await setCache(`workspace:${workspaceId}`, {
      workspaceId,
      ownerId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt
    }, 1800);

    return workspace;
  }

  /**
   * Retrieves an active workspace for a repository.
   * @param {string} repositoryId
   * @param {string} ownerId
   * @param {boolean} readOnly - If true, does NOT update lastActivity (safe for polling)
   */
  static async getWorkspace(repositoryId, ownerId, readOnly = false) {
    let workspace = await Workspace.findOne({ repositoryId, ownerId }).sort({ createdAt: -1 });
    
    // Legacy fallback: If no workspace exists but the repository exists, create one bridging to the old path.
    if (!workspace) {
      const repository = await Repository.findOne({ _id: repositoryId, userId: ownerId });
      if (repository && repository.metadata && repository.metadata.storagePath) {
        console.log(`[WorkspaceManager] Creating legacy fallback workspace for repository ${repositoryId}`);
        const workspaceId = crypto.randomUUID();
        workspace = new Workspace({
          workspaceId,
          repositoryId: repository._id,
          repositoryType: repository.url.includes('github') ? 'github' : 'zip',
          ownerId: ownerId,
          repositoryPath: repository.metadata.storagePath, // Map directly to legacy path
          lastActivity: new Date(),
          status: 'ACTIVE'
        });
        await workspace.save();

        // Save workspace metadata to Redis with 30 minute TTL (1800s)
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await setCache(`workspace:${workspaceId}`, {
          workspaceId,
          ownerId,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          expiresAt
        }, 1800);
      }
    }

    let diskExists = false;
    if (workspace && workspace.repositoryPath) {
      try {
        await fs.access(workspace.repositoryPath);
        diskExists = true;
      } catch {
        diskExists = false;
        console.warn(`[WorkspaceManager] Workspace ${workspace.workspaceId} exists in DB but missing from disk.`);
      }
    }

    if (!workspace || !diskExists) {
      if (workspace && !diskExists) {
        await Workspace.deleteOne({ _id: workspace._id });
      }
      return null;
    }

    // Only update lastActivity for non-read-only (actual user activity) calls
    if (workspace && diskExists && !readOnly) {
      await this.updateLastActivity(workspace.workspaceId);
      // Re-fetch to return the document with updated timestamps
      workspace = await Workspace.findOne({ workspaceId: workspace.workspaceId });
    }

    return workspace || null;
  }

  /**
   * Updates the lastActivity timestamp for a given workspace and resets status to ACTIVE.
   */
  static async updateLastActivity(workspaceId, markDirty = false) {
    try {
      const updateData = { lastActivity: new Date(), status: 'ACTIVE' };
      if (markDirty) {
        updateData.dirty = true;
      }
      
      await Workspace.findOneAndUpdate(
        { workspaceId },
        { $set: updateData }
      );
      console.log(`[WorkspaceManager] Updated activity for workspace ${workspaceId}`);
    } catch (err) {
      console.error(`[WorkspaceManager] Failed to update activity for ${workspaceId}:`, err);
    }
  }

  /**
   * Starts the background cron job to monitor inactivity.
   */
  static startInactivityMonitor() {
    setInterval(async () => {
      try {
        const now = new Date();
        const warningThreshold = new Date(now.getTime() - 30 * 60 * 1000);
        const cleaningThreshold = new Date(now.getTime() - 60 * 60 * 1000);

        // Transition to WARNING (inactive for > 30 mins)
        const warningResult = await Workspace.updateMany(
          { status: 'ACTIVE', lastActivity: { $lte: warningThreshold } },
          { $set: { status: 'WARNING' } }
        );
        if (warningResult.modifiedCount > 0) {
          console.log(`[WorkspaceManager] Transitioned ${warningResult.modifiedCount} workspaces to WARNING state`);
        }

        // Transition to CLEANING (inactive for > 60 mins)
        const workspacesToClean = await Workspace.find({ status: 'WARNING', lastActivity: { $lte: cleaningThreshold } });
        
        for (const workspace of workspacesToClean) {
          workspace.status = 'CLEANING';
          await workspace.save();
          console.log(`[WorkspaceManager] Workspace ${workspace.workspaceId} entered CLEANING state.`);

          try {
            await WorkspaceManager.deleteWorkspace(workspace.workspaceId);
          } catch (cleanupError) {
            console.error(`[WorkspaceManager] Failed to cleanup workspace ${workspace.workspaceId}:`, cleanupError);
          }
        }
      } catch (error) {
        console.error('[WorkspaceManager] Error in inactivity monitor:', error);
      }
    }, 60 * 1000);
  }

  /**
   * Deletes a workspace and its associated directory.
   */
  static async deleteWorkspace(workspaceId) {
    try {
      // 1. Always attempt to delete from Redis (idempotent)
      await delCache(`workspace:${workspaceId}`);

      const workspace = await Workspace.findOne({ workspaceId });

      // 2. Resolve directory path and delete (idempotent)
      const targetPath = workspace ? workspace.repositoryPath : path.join(WORKSPACE_DIR, workspaceId);
      console.log(`[WorkspaceManager] Deleting workspace ${workspaceId} at ${targetPath}`);
      
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
      } catch (fsErr) {
        console.error(`[WorkspaceManager] Failed to delete directory ${targetPath}:`, fsErr);
      }

      // If DB entry missing, we're done
      if (!workspace) return;

      // Isolate ReviewHistory cleanup for ZIP repositories
      if (workspace.repositoryType === 'zip') {
        const ReviewHistory = require('../models/ReviewHistory');
        try {
          const deleteResult = await ReviewHistory.deleteMany({ workspaceId: workspaceId });
          console.log(`[WorkspaceManager] Deleted ${deleteResult.deletedCount} reviews associated with ZIP workspace ${workspaceId}`);
        } catch (rhErr) {
          console.error(`[WorkspaceManager] Failed to delete isolated reviews for ${workspaceId}:`, rhErr);
        }
      }

      await Workspace.deleteOne({ workspaceId });
    } catch (err) {
      console.error(`[WorkspaceManager] Failed to delete workspace ${workspaceId}:`, err);
      throw err;
    }
  }
}

WorkspaceManager.init();
WorkspaceManager.startInactivityMonitor();

module.exports = WorkspaceManager;
