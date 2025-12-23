import { CodingSessionRepository } from '../repositories/codingSessionRepository';
import { ProjectRepository } from '../repositories/projectRepository';
import { AIService } from './aiService';
import { CodingSession } from '@devflow-studio/shared';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export interface ReviewResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  output: string;
  fixed: boolean;
  iterations: number;
}

export class ReviewService {
  private sessionRepo: CodingSessionRepository;
  private projectRepo: ProjectRepository;
  private aiService: AIService;

  constructor() {
    this.sessionRepo = new CodingSessionRepository();
    this.projectRepo = new ProjectRepository();
    this.aiService = new AIService();
  }

  /**
   * Start review process for a coding session
   * This will execute the code, detect errors, and fix them iteratively
   */
  async startReview(sessionId: string): Promise<{ review_job_id: string; message: string }> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Coding session not found');
    }

    if (session.status !== 'completed') {
      throw new Error('Can only review completed coding sessions');
    }

    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Update session status to reviewing
    // Note: 'reviewing' must be added to the database constraint
    await this.sessionRepo.update(sessionId, {
      status: 'reviewing' as any,
    });

    // Create AI job for review process
    const reviewPrompt = await this.buildReviewPrompt(session, project);
    const reviewJob = await this.aiService.createAIJob({
      project_id: project.id,
      task_id: session.story_id,
      provider: 'cursor',
      mode: 'review',
      prompt: reviewPrompt,
    }, {
      coding_session_id: sessionId,
      phase: 'code_review',
      review_iteration: 0,
    });

    return {
      review_job_id: reviewJob.id,
      message: 'Review process started',
    };
  }

  /**
   * Build prompt for review process
   */
  private async buildReviewPrompt(session: CodingSession, project: any): Promise<string> {
    const lines: string[] = [];
    
    lines.push('# Code Review and Error Fixing Task');
    lines.push('');
    lines.push('## Objective');
    lines.push('Review the generated code, execute it locally, detect any errors, and fix them automatically.');
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('1. **Execute the code**:');
    lines.push('   - Try to build/compile the project');
    lines.push('   - Run any available tests');
    lines.push('   - Check for runtime errors');
    lines.push('');
    lines.push('2. **Detect errors**:');
    lines.push('   - Compilation errors (syntax, type errors, missing imports)');
    lines.push('   - Test failures');
    lines.push('   - Runtime errors');
    lines.push('   - Linting errors');
    lines.push('');
    lines.push('3. **Fix errors automatically**:');
    lines.push('   - For each error found, create a fix');
    lines.push('   - Apply the fix to the code');
    lines.push('   - Re-run the execution to verify the fix');
    lines.push('');
    lines.push('4. **Iterate until no errors**:');
    lines.push('   - Continue fixing errors until all tests pass');
    lines.push('   - Ensure the code compiles without errors');
    lines.push('   - Verify runtime execution works');
    lines.push('');
    lines.push('## Project Information');
    lines.push(`- **Project Path**: ${project.base_path}`);
    lines.push(`- **Tech Stack**: ${project.tech_stack || 'Not specified'}`);
    lines.push('');
    lines.push('## Execution Commands');
    lines.push('');
    lines.push('Based on the tech stack, execute appropriate commands:');
    lines.push('- **TypeScript/Node.js**: `npm run build`, `npm test`, `npm start`');
    lines.push('- **Python**: `python -m pytest`, `python -m mypy`, `python main.py`');
    lines.push('- **Java**: `mvn compile`, `mvn test`, `mvn exec:java`');
    lines.push('- **Other**: Use appropriate build/test/run commands');
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
    lines.push('');
    lines.push('## Output Format');
    lines.push('');
    lines.push('After each iteration, report:');
    lines.push('- Errors found (if any)');
    lines.push('- Fixes applied');
    lines.push('- Execution results');
    lines.push('- Next steps (if more errors exist)');
    lines.push('');
    lines.push('Continue until all errors are resolved or maximum iterations reached.');

    return lines.join('\n');
  }

  /**
   * Execute a command and detect errors
   */
  async executeCommand(
    projectPath: string,
    command: string,
    args: string[] = []
  ): Promise<{ success: boolean; output: string; errors: string[]; exitCode: number }> {
    return new Promise((resolve) => {
      const childProcess = spawn(command, args, {
        cwd: projectPath,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      childProcess.on('close', (code) => {
        const errors: string[] = [];
        
        // Detect errors from exit code
        if (code !== 0) {
          errors.push(`Command failed with exit code ${code}`);
        }

        // Detect errors from stderr
        if (errorOutput) {
          const errorLines = errorOutput.split('\n').filter(line => 
            line.trim() && 
            !line.includes('warning') && // Filter warnings
            !line.includes('WARNING')
          );
          errors.push(...errorLines);
        }

        // Detect common error patterns in output
        const errorPatterns = [
          /error:/gi,
          /Error:/g,
          /ERROR:/g,
          /failed/gi,
          /Failed/gi,
          /FAILED/gi,
          /exception/gi,
          /Exception/gi,
          /TypeError/gi,
          /ReferenceError/gi,
          /SyntaxError/gi,
        ];

        const outputLines = output.split('\n');
        for (const line of outputLines) {
          for (const pattern of errorPatterns) {
            if (pattern.test(line) && !line.includes('warning')) {
              errors.push(line.trim());
              break;
            }
          }
        }

        resolve({
          success: code === 0 && errors.length === 0,
          output: output + errorOutput,
          errors: [...new Set(errors)], // Remove duplicates
          exitCode: code || 0,
        });
      });

      childProcess.on('error', (error) => {
        resolve({
          success: false,
          output: errorOutput,
          errors: [error.message],
          exitCode: -1,
        });
      });
    });
  }

  /**
   * Detect project type and get appropriate commands
   */
  async detectProjectType(projectPath: string): Promise<{
    type: string;
    buildCommand?: string[];
    testCommand?: string[];
    runCommand?: string[];
  }> {
    // Check for package.json (Node.js/TypeScript)
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      await fs.access(packageJsonPath);
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      return {
        type: 'node',
        buildCommand: packageJson.scripts?.build ? ['npm', 'run', 'build'] : undefined,
        testCommand: packageJson.scripts?.test ? ['npm', 'test'] : undefined,
        runCommand: packageJson.scripts?.start ? ['npm', 'start'] : undefined,
      };
    } catch {
      // Not Node.js
    }

    // Check for requirements.txt (Python)
    try {
      await fs.access(path.join(projectPath, 'requirements.txt'));
      return {
        type: 'python',
        testCommand: ['python', '-m', 'pytest'],
        runCommand: ['python', 'main.py'],
      };
    } catch {
      // Not Python
    }

    // Check for pom.xml (Java/Maven)
    try {
      await fs.access(path.join(projectPath, 'pom.xml'));
      return {
        type: 'java',
        buildCommand: ['mvn', 'compile'],
        testCommand: ['mvn', 'test'],
        runCommand: ['mvn', 'exec:java'],
      };
    } catch {
      // Not Java
    }

    // Default
    return {
      type: 'unknown',
    };
  }
}

