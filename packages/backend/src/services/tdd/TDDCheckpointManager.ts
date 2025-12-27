import * as fs from 'fs/promises';
import * as path from 'path';
import { ensureDirectory } from '../../utils/fileSystem';
import { ProjectStructureService } from '../projectStructureService';

export interface CheckpointMetadata {
  phase: string;
  testIndex: number;
  timestamp: string;
  sessionId: string;
}

export class TDDCheckpointManager {
  private projectPath: string;
  private sessionId: string;
  private checkpointsBasePath: string;
  private structureService: ProjectStructureService;

  constructor(projectPath: string, sessionId: string) {
    this.projectPath = projectPath;
    this.sessionId = sessionId;
    this.checkpointsBasePath = path.join(projectPath, '.tdd-checkpoints', sessionId);
    this.structureService = new ProjectStructureService();
  }

  /**
   * Create a checkpoint by copying src/ and tests/ directories
   */
  async createCheckpoint(phase: string, testIndex: number): Promise<string> {
    try {
      const checkpointName = `${phase}-test${testIndex}`;
      const checkpointPath = path.join(this.checkpointsBasePath, checkpointName);
      
      await ensureDirectory(checkpointPath);

      // Determine source directories using ProjectStructureService
      // For most projects, we'll look for common patterns: src/, tests/, test/
      const srcDirs = await this.detectSourceDirectories();
      
      // Copy each source directory
      for (const srcDir of srcDirs) {
        const srcPath = path.join(this.projectPath, srcDir);
        const destPath = path.join(checkpointPath, srcDir);
        
        try {
          const stats = await fs.stat(srcPath);
          if (stats.isDirectory()) {
            await this.copyDir(srcPath, destPath);
            console.log(`[TDD-CheckpointManager] Copied ${srcDir} to checkpoint`);
          }
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            console.warn(`[TDD-CheckpointManager] Could not copy ${srcDir}:`, error.message);
          }
        }
      }

      // Create metadata.json
      const metadata: CheckpointMetadata = {
        phase,
        testIndex,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId
      };

      const metadataPath = path.join(checkpointPath, 'metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      console.log(`[TDD-CheckpointManager] ✅ Created checkpoint: ${checkpointName}`);
      return checkpointPath;
    } catch (error) {
      console.error('[TDD-CheckpointManager] Error creating checkpoint:', error);
      throw error;
    }
  }

  /**
   * Detect source directories in the project
   */
  private async detectSourceDirectories(): Promise<string[]> {
    const commonDirs = ['src', 'tests', 'test', 'lib', 'app'];
    const detectedDirs: string[] = [];

    for (const dir of commonDirs) {
      const dirPath = path.join(this.projectPath, dir);
      try {
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          detectedDirs.push(dir);
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    // If no directories found, default to src and tests
    if (detectedDirs.length === 0) {
      return ['src', 'tests'];
    }

    return detectedDirs;
  }

  /**
   * Recursively copy directory
   */
  private async copyDir(src: string, dest: string): Promise<void> {
    try {
      await ensureDirectory(dest);
      
      const entries = await fs.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await this.copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    } catch (error) {
      console.error(`[TDD-CheckpointManager] Error copying ${src} to ${dest}:`, error);
      throw error;
    }
  }

  /**
   * Rollback to the last checkpoint
   */
  async rollbackToLastCheckpoint(): Promise<void> {
    try {
      const checkpoints = await this.listCheckpoints();
      
      if (checkpoints.length === 0) {
        throw new Error('No checkpoints available to rollback');
      }

      // Get the most recent checkpoint
      const lastCheckpoint = checkpoints[checkpoints.length - 1];
      const checkpointPath = path.join(this.checkpointsBasePath, `${lastCheckpoint.phase}-test${lastCheckpoint.testIndex}`);

      // Restore each directory from checkpoint
      const entries = await fs.readdir(checkpointPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'metadata.json') {
          const checkpointDir = path.join(checkpointPath, entry.name);
          const projectDir = path.join(this.projectPath, entry.name);

          // Remove existing directory
          try {
            await fs.rm(projectDir, { recursive: true, force: true });
          } catch {
            // Ignore if doesn't exist
          }

          // Copy from checkpoint
          await this.copyDir(checkpointDir, projectDir);
        }
      }

      console.log(`[TDD-CheckpointManager] ✅ Rolled back to checkpoint: ${lastCheckpoint.phase}-test${lastCheckpoint.testIndex}`);
    } catch (error) {
      console.error('[TDD-CheckpointManager] Error rolling back:', error);
      throw error;
    }
  }

  /**
   * List all available checkpoints
   */
  async listCheckpoints(): Promise<Array<{ phase: string; testIndex: number; timestamp: string }>> {
    try {
      const checkpoints: Array<{ phase: string; testIndex: number; timestamp: string }> = [];

      // Check if checkpoints directory exists
      try {
        await fs.access(this.checkpointsBasePath);
      } catch {
        return checkpoints; // No checkpoints directory, return empty
      }

      const entries = await fs.readdir(this.checkpointsBasePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metadataPath = path.join(this.checkpointsBasePath, entry.name, 'metadata.json');
          
          try {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata: CheckpointMetadata = JSON.parse(metadataContent);
            
            checkpoints.push({
              phase: metadata.phase,
              testIndex: metadata.testIndex,
              timestamp: metadata.timestamp
            });
          } catch {
            // Skip if metadata is invalid
            console.warn(`[TDD-CheckpointManager] Invalid metadata for checkpoint: ${entry.name}`);
          }
        }
      }

      // Sort by timestamp
      checkpoints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return checkpoints;
    } catch (error) {
      console.error('[TDD-CheckpointManager] Error listing checkpoints:', error);
      return [];
    }
  }
}

