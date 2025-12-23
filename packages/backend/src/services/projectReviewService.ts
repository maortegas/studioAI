import { ProjectRepository } from '../repositories/projectRepository';
import { AIService } from './aiService';
import { ReviewService } from './reviewService';
import { EventEmitter } from 'events';
import { Pool } from 'pg';
import pool from '../config/database';

export interface ActionableItem {
  id: string;
  error_message: string;
  category: 'dependency' | 'syntax' | 'type' | 'test' | 'build' | 'other';
  priority: 'high' | 'medium' | 'low';
  file_path?: string;
  line_number?: number;
  error_type?: string;
  suggested_fix?: string;
  status: 'pending' | 'fixing' | 'fixed' | 'skipped';
}

export interface ProjectReviewStatus {
  status: 'idle' | 'running' | 'errors_detected' | 'completed' | 'failed';
  current_step?: string;
  progress?: number;
  build_status?: 'pending' | 'running' | 'success' | 'failed';
  test_status?: 'pending' | 'running' | 'success' | 'failed';
  errors?: string[];
  warnings?: string[];
  iterations?: number;
  output?: string;
  actionable_items?: ActionableItem[];
  install_output?: string;
  build_output?: string;
  test_output?: string;
}

type ReviewEvent = {
  type: 'progress' | 'output' | 'error' | 'completed' | 'failed';
  step?: string;
  progress?: number;
  build_status?: 'pending' | 'running' | 'success' | 'failed';
  test_status?: 'pending' | 'running' | 'success' | 'failed';
  iterations?: number;
  content?: string;
  message?: string;
};

export class ProjectReviewService extends EventEmitter {
  private projectRepo: ProjectRepository;
  private aiService: AIService;
  private reviewService: ReviewService;
  private activeReviews: Map<string, { jobId: string; eventEmitter: EventEmitter }> = new Map();

  constructor() {
    super();
    this.projectRepo = new ProjectRepository();
    this.aiService = new AIService();
    this.reviewService = new ReviewService();
  }

  /**
   * Start project review
   */
  async startProjectReview(projectId: string): Promise<{ review_job_id: string; message: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check if review is already running
    const existing = this.activeReviews.get(projectId);
    if (existing) {
      throw new Error('Review is already running for this project');
    }

    // Build review prompt for entire project
    const reviewPrompt = await this.buildProjectReviewPrompt(project);

    // Create AI job for project review
    const reviewJob = await this.aiService.createAIJob({
      project_id: projectId,
      provider: 'cursor',
      mode: 'review',
      prompt: reviewPrompt,
    }, {
      project_id: projectId,
      phase: 'project_review',
      review_iteration: 0,
    });

    // Store active review
    const eventEmitter = new EventEmitter();
    this.activeReviews.set(projectId, { jobId: reviewJob.id, eventEmitter });

    // Store review status in database (create a simple table or use a JSON field)
    await this.updateReviewStatus(projectId, {
      status: 'running',
      progress: 0,
      iterations: 0,
    });

    return {
      review_job_id: reviewJob.id,
      message: 'Project review started',
    };
  }

  /**
   * Stop project review
   */
  async stopProjectReview(projectId: string): Promise<void> {
    const active = this.activeReviews.get(projectId);
    if (!active) {
      throw new Error('No active review found for this project');
    }

    // Cancel the AI job (mark as failed/cancelled)
    await pool.query(
      'UPDATE ai_jobs SET status = $1 WHERE id = $2',
      ['failed', active.jobId]
    );

    // Update status
    await this.updateReviewStatus(projectId, {
      status: 'failed',
    });

    // Remove from active reviews
    this.activeReviews.delete(projectId);
    active.eventEmitter.emit('stopped');
  }

  /**
   * Get review status
   */
  async getReviewStatus(projectId: string): Promise<ProjectReviewStatus> {
    const result = await pool.query(
      `SELECT review_status FROM projects WHERE id = $1`,
      [projectId]
    );

    if (result.rows.length === 0) {
      throw new Error('Project not found');
    }

    const reviewStatus = result.rows[0].review_status;
    if (!reviewStatus) {
      return { status: 'idle' };
    }

    return reviewStatus as ProjectReviewStatus;
  }

  /**
   * Subscribe to review events
   */
  subscribeToEvents(projectId: string, callback: (event: ReviewEvent) => void): () => void {
    const active = this.activeReviews.get(projectId);
    if (!active) {
      // Return empty unsubscribe function if no active review
      return () => {};
    }

    const handler = (event: ReviewEvent) => callback(event);
    active.eventEmitter.on('event', handler);

    // Return unsubscribe function
    return () => {
      active.eventEmitter.off('event', handler);
    };
  }

  /**
   * Update review status in database
   */
  private async updateReviewStatus(projectId: string, status: Partial<ProjectReviewStatus>): Promise<void> {
    // First, check if review_status column exists, if not we'll use a JSONB field
    // For now, we'll store it in a simple JSONB column
    const current = await this.getReviewStatus(projectId);
    const updated = { ...current, ...status };

    await pool.query(
      `UPDATE projects 
       SET review_status = $1::jsonb 
       WHERE id = $2`,
      [JSON.stringify(updated), projectId]
    );
  }

  /**
   * Fix selected errors
   */
  async fixSelectedErrors(projectId: string, errorIds: string[]): Promise<{ fix_job_id: string; message: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Get current review status
    const status = await this.getReviewStatus(projectId);
    if (!status.actionable_items) {
      throw new Error('No actionable items found. Please run review first.');
    }

    // Filter selected items
    const selectedItems = status.actionable_items.filter(item => errorIds.includes(item.id));
    if (selectedItems.length === 0) {
      throw new Error('No valid error items selected');
    }

    // Build fix prompt for selected errors
    const fixPrompt = await this.buildFixPrompt(selectedItems, status);

    // Create AI job to fix selected errors
    const fixJob = await this.aiService.createAIJob({
      project_id: projectId,
      provider: 'cursor',
      mode: 'agent',
      prompt: fixPrompt,
    }, {
      project_id: projectId,
      phase: 'project_review_fix',
      error_ids: errorIds,
      review_iteration: (status.iterations || 0) + 1,
    });

    // Update status to show fixing
    await this.updateReviewStatus(projectId, {
      status: 'running',
      current_step: `Fixing ${selectedItems.length} selected error(s)`,
      progress: 85,
    });

    // Update actionable items status
    const updatedItems = status.actionable_items.map(item => {
      if (errorIds.includes(item.id)) {
        return { ...item, status: 'fixing' as const };
      }
      return item;
    });

    await this.updateReviewStatus(projectId, {
      actionable_items: updatedItems,
    });

    return {
      fix_job_id: fixJob.id,
      message: `Fix job created for ${selectedItems.length} error(s)`,
    };
  }

  /**
   * Build fix prompt for selected errors
   */
  private async buildFixPrompt(selectedItems: ActionableItem[], reviewStatus: ProjectReviewStatus): Promise<string> {
    const lines: string[] = [];
    
    lines.push('# Fix Selected Project Errors');
    lines.push('');
    lines.push('## Selected Errors to Fix');
    lines.push('');
    
    selectedItems.forEach((item, index) => {
      lines.push(`### Error ${index + 1}: ${item.category} (${item.priority} priority)`);
      lines.push(`**Error Message:** ${item.error_message}`);
      if (item.file_path) {
        lines.push(`**File:** ${item.file_path}`);
      }
      if (item.line_number) {
        lines.push(`**Line:** ${item.line_number}`);
      }
      lines.push('');
    });
    
    lines.push('## Context');
    lines.push('');
    if (reviewStatus.build_output) {
      lines.push('### Build Output');
      lines.push('```');
      lines.push(reviewStatus.build_output.substring(0, 3000));
      lines.push('```');
      lines.push('');
    }
    
    if (reviewStatus.test_output) {
      lines.push('### Test Output');
      lines.push('```');
      lines.push(reviewStatus.test_output.substring(0, 3000));
      lines.push('```');
      lines.push('');
    }
    
    lines.push('## Instructions');
    lines.push('');
    lines.push('1. Fix ONLY the selected errors listed above');
    lines.push('2. For each error:');
    lines.push('   - Locate the file and line (if specified)');
    lines.push('   - Understand the root cause');
    lines.push('   - Apply the appropriate fix');
    lines.push('   - Ensure the fix doesn\'t break other parts');
    lines.push('3. After fixing, the system will re-run build and tests');
    lines.push('4. Do NOT fix errors that were not selected');
    lines.push('');
    lines.push('Fix the selected errors systematically and ensure the project compiles and tests pass.');

    return lines.join('\n');
  }

  /**
   * Get file content
   */
  async getFileContent(projectId: string, filePath: string): Promise<{ content: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const fs = require('fs/promises');
    const path = require('path');
    
    // Normalize the file path - handle duplicate paths and absolute paths
    let normalizedPath = filePath;
    const resolvedBasePath = path.resolve(project.base_path);
    
    // If path is absolute, try to extract relative path
    if (path.isAbsolute(filePath)) {
      const resolvedFilePath = path.resolve(filePath);
      
      // Check if the file path contains the base_path (even if duplicated)
      if (resolvedFilePath.includes(resolvedBasePath)) {
        // Find the last occurrence of base_path to handle duplicates
        const lastIndex = resolvedFilePath.lastIndexOf(resolvedBasePath);
        if (lastIndex >= 0) {
          // Extract everything after the last occurrence of base_path
          normalizedPath = resolvedFilePath.substring(lastIndex + resolvedBasePath.length);
          // Remove leading slashes
          normalizedPath = normalizedPath.replace(/^[/\\]+/, '');
        } else {
          // Try using path.relative
          normalizedPath = path.relative(resolvedBasePath, resolvedFilePath);
        }
      } else {
        // Path doesn't contain base_path, try to make it relative
        // This handles cases where the path might be from a different location
        normalizedPath = filePath.replace(resolvedBasePath, '').replace(/^[/\\]+/, '');
      }
    }
    
    // Remove leading slashes and normalize
    normalizedPath = normalizedPath.replace(/^[/\\]+/, '');
    
    // Build the full path
    const fullPath = path.join(resolvedBasePath, normalizedPath);
    const resolvedPath = path.resolve(fullPath);
    
    // Security: Ensure the final path is within the project base_path
    if (!resolvedPath.startsWith(resolvedBasePath)) {
      throw new Error(`Invalid file path: path outside project directory. Path: ${resolvedPath}, Base: ${resolvedBasePath}`);
    }

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return { content };
    } catch (error: any) {
      throw new Error(`Failed to read file: ${error.message}. Tried path: ${resolvedPath}`);
    }
  }

  /**
   * Open file in system editor
   */
  async openFileInEditor(projectId: string, filePath: string, lineNumber?: number): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const { spawn } = require('child_process');
    const path = require('path');
    
    // Normalize the file path (same logic as getFileContent)
    let normalizedPath = filePath;
    const resolvedBasePath = path.resolve(project.base_path);
    
    if (path.isAbsolute(filePath)) {
      const resolvedFilePath = path.resolve(filePath);
      
      if (resolvedFilePath.includes(resolvedBasePath)) {
        const lastIndex = resolvedFilePath.lastIndexOf(resolvedBasePath);
        if (lastIndex >= 0) {
          normalizedPath = resolvedFilePath.substring(lastIndex + resolvedBasePath.length);
          normalizedPath = normalizedPath.replace(/^[/\\]+/, '');
        } else {
          normalizedPath = path.relative(resolvedBasePath, resolvedFilePath);
        }
      } else {
        normalizedPath = filePath.replace(resolvedBasePath, '').replace(/^[/\\]+/, '');
      }
    }
    
    normalizedPath = normalizedPath.replace(/^[/\\]+/, '');
    const fullPath = path.join(resolvedBasePath, normalizedPath);
    const resolvedPath = path.resolve(fullPath);
    
    if (!resolvedPath.startsWith(resolvedBasePath)) {
      throw new Error(`Invalid file path: path outside project directory. Path: ${resolvedPath}, Base: ${resolvedBasePath}`);
    }

    // Try different editors based on OS
    const isMac = process.platform === 'darwin';
    const isWindows = process.platform === 'win32';
    const isLinux = process.platform === 'linux';

    let command: string;
    let args: string[];

    if (isMac) {
      // macOS: try code (VS Code) first, then open
      command = 'code';
      args = lineNumber ? ['--goto', `${fullPath}:${lineNumber}`] : [fullPath];
    } else if (isWindows) {
      command = 'code';
      args = lineNumber ? ['--goto', `${fullPath}:${lineNumber}`] : [fullPath];
    } else {
      // Linux: try code, then xdg-open
      command = 'code';
      args = lineNumber ? ['--goto', `${fullPath}:${lineNumber}`] : [fullPath];
    }

    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });

      childProcess.on('error', (error: Error) => {
        // If code command fails, try alternative
        if (command === 'code') {
          if (isMac) {
            spawn('open', [fullPath], { detached: true, stdio: 'ignore' });
          } else if (isLinux) {
            spawn('xdg-open', [fullPath], { detached: true, stdio: 'ignore' });
          } else if (isWindows) {
            spawn('notepad', [fullPath], { detached: true, stdio: 'ignore' });
          }
        }
        resolve(); // Don't reject, just try alternative
      });

      childProcess.unref();
      resolve();
    });
  }

  /**
   * Run command for a single error
   */
  async runSingleError(projectId: string, errorId: string, category: string): Promise<{ job_id: string; message: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Get review status to find the error
    const status = await this.getReviewStatus(projectId);
    if (!status.actionable_items) {
      throw new Error('No actionable items found');
    }

    const errorItem = status.actionable_items.find(item => item.id === errorId);
    if (!errorItem) {
      throw new Error('Error item not found');
    }

    // Determine command based on category
    let command: string[] | undefined;
    const fs = require('fs/promises');
    const path = require('path');
    const projectPath = project.base_path;

    try {
      // Check for package.json (Node.js/TypeScript)
      const packageJsonPath = path.join(projectPath, 'package.json');
      await fs.access(packageJsonPath);
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (category === 'build' && packageJson.scripts?.build) {
        command = ['npm', 'run', 'build'];
      } else if (category === 'test' && packageJson.scripts?.test) {
        command = ['npm', 'test'];
      } else if (category === 'dependency') {
        command = ['npm', 'install'];
      }
    } catch {
      // Not Node.js project, try other types
    }

    if (!command) {
      throw new Error(`No command available for category: ${category}`);
    }

    // Create AI job to run the command
    const runJob = await this.aiService.createAIJob({
      project_id: projectId,
      provider: 'cursor',
      mode: 'agent',
      prompt: `Execute the following command to check/fix this specific error:\n\nCommand: ${command.join(' ')}\n\nError: ${errorItem.error_message}\n\nCategory: ${category}\n\nRun the command and report the results.`,
    }, {
      project_id: projectId,
      phase: 'project_review_single_run',
      error_id: errorId,
      category,
      command: command.join(' '),
    });

    return {
      job_id: runJob.id,
      message: `Running command: ${command.join(' ')}`,
    };
  }

  /**
   * Save file content
   */
  async saveFileContent(projectId: string, filePath: string, content: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const fs = require('fs/promises');
    const path = require('path');
    
    // Normalize the file path (same logic as getFileContent)
    let normalizedPath = filePath;
    const resolvedBasePath = path.resolve(project.base_path);
    
    if (path.isAbsolute(filePath)) {
      const resolvedFilePath = path.resolve(filePath);
      
      if (resolvedFilePath.includes(resolvedBasePath)) {
        const lastIndex = resolvedFilePath.lastIndexOf(resolvedBasePath);
        if (lastIndex >= 0) {
          normalizedPath = resolvedFilePath.substring(lastIndex + resolvedBasePath.length);
          normalizedPath = normalizedPath.replace(/^[/\\]+/, '');
        } else {
          normalizedPath = path.relative(resolvedBasePath, resolvedFilePath);
        }
      } else {
        normalizedPath = filePath.replace(resolvedBasePath, '').replace(/^[/\\]+/, '');
      }
    }
    
    normalizedPath = normalizedPath.replace(/^[/\\]+/, '');
    const fullPath = path.join(resolvedBasePath, normalizedPath);
    const resolvedPath = path.resolve(fullPath);
    
    if (!resolvedPath.startsWith(resolvedBasePath)) {
      throw new Error(`Invalid file path: path outside project directory. Path: ${resolvedPath}, Base: ${resolvedBasePath}`);
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(resolvedPath, content, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to save file: ${error.message}`);
    }
  }

  /**
   * Build prompt for project review
   */
  private async buildProjectReviewPrompt(project: any): Promise<string> {
    const lines: string[] = [];
    
    lines.push('# Full Project Review and Error Fixing Task');
    lines.push('');
    lines.push('## Objective');
    lines.push('Review the ENTIRE project codebase, execute it locally, detect ALL errors, and fix them automatically.');
    lines.push('');
    lines.push('## Project Information');
    lines.push(`- **Project Path**: ${project.base_path}`);
    lines.push(`- **Tech Stack**: ${project.tech_stack || 'Not specified'}`);
    lines.push(`- **Project Name**: ${project.name}`);
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('1. **Execute the ENTIRE project**:');
    lines.push('   - Build/compile the complete project');
    lines.push('   - Run ALL available tests');
    lines.push('   - Check for runtime errors');
    lines.push('   - Verify all dependencies are installed');
    lines.push('');
    lines.push('2. **Detect ALL errors**:');
    lines.push('   - Compilation errors across all files');
    lines.push('   - Test failures');
    lines.push('   - Runtime errors');
    lines.push('   - Missing dependencies');
    lines.push('   - Configuration errors');
    lines.push('   - Linting errors');
    lines.push('');
    lines.push('3. **Fix errors systematically**:');
    lines.push('   - Fix errors in order of dependency');
    lines.push('   - Ensure fixes don\'t break other parts');
    lines.push('   - Re-run build and tests after each fix');
    lines.push('');
    lines.push('4. **Iterate until no errors**:');
    lines.push('   - Continue fixing until all tests pass');
    lines.push('   - Ensure the entire project compiles');
    lines.push('   - Verify the project runs successfully');
    lines.push('');
    lines.push('## Execution Commands');
    lines.push('');
    lines.push('Based on the tech stack, execute appropriate commands:');
    lines.push('- **TypeScript/Node.js**: `npm install`, `npm run build`, `npm test`, `npm start`');
    lines.push('- **Python**: `pip install -r requirements.txt`, `python -m pytest`, `python main.py`');
    lines.push('- **Java**: `mvn clean install`, `mvn test`, `mvn exec:java`');
    lines.push('- **Other**: Use appropriate build/test/run commands for the entire project');
    lines.push('');
    lines.push('## Error Detection');
    lines.push('');
    lines.push('Look for:');
    lines.push('- Exit codes != 0');
    lines.push('- Error messages in stderr');
    lines.push('- Test failure messages');
    lines.push('- Compilation errors');
    lines.push('- Type errors');
    lines.push('- Missing dependencies');
    lines.push('- Configuration errors');
    lines.push('');
    lines.push('## Output Format');
    lines.push('');
    lines.push('After each iteration, report:');
    lines.push('- Errors found (if any)');
    lines.push('- Fixes applied');
    lines.push('- Execution results');
    lines.push('- Next steps (if more errors exist)');
    lines.push('');
    lines.push('Continue until ALL errors are resolved or maximum iterations reached.');

    return lines.join('\n');
  }
}

