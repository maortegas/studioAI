import { spawn } from 'child_process';
import { AIProvider, AIMode } from '@devflow-studio/shared';
import { EventEmitter } from 'events';

export interface CLIResult {
  success: boolean;
  output: string;
  error?: string;
}

export class ClaudeCLI extends EventEmitter {
  async execute(
    mode: AIMode,
    prompt: string,
    projectPath: string,
    options: { timeout?: number } = {}
  ): Promise<CLIResult> {
    return new Promise((resolve, reject) => {
      // Build command based on mode
      let command: string;
      let args: string[] = [];

      // Execute in batch/non-interactive mode (no UI windows)
      // IMPORTANT: Adjust flags based on actual Claude CLI interface
      // Common flags: --batch, --non-interactive, --no-ui, --headless, --stdin
      // See CLI_REFERENCE.md for details
      if (mode === 'plan') {
        command = 'claude';
        args = [
          'plan',
          '--batch',              // Batch mode - no interaction
          '--non-interactive',    // Non-interactive execution
          '--no-ui',              // Don't open UI windows
          '--prompt', prompt,     // Pass the prompt (includes PRD)
          '--project', projectPath
        ];
      } else if (mode === 'patch') {
        command = 'claude';
        args = [
          'patch',
          '--batch',
          '--non-interactive',
          '--no-ui',
          '--prompt', prompt,
          '--project', projectPath
        ];
      } else if (mode === 'review') {
        command = 'claude';
        args = [
          'review',
          '--batch',
          '--non-interactive',
          '--no-ui',
          '--prompt', prompt,
          '--project', projectPath
        ];
      } else {
        return reject(new Error(`Unsupported mode: ${mode}`));
      }

      const process = spawn(command, args, {
        cwd: projectPath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr - no inherit to prevent UI
        detached: false, // Don't detach to prevent new windows
      });

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        this.emit('output', text);
      });

      process.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        this.emit('error', text);
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output,
            error: errorOutput || undefined,
          });
        } else {
          resolve({
            success: false,
            output,
            error: errorOutput || `Process exited with code ${code}`,
          });
        }
      });

      process.on('error', (error) => {
        reject(error);
      });

      // Timeout handling
      if (options.timeout) {
        setTimeout(() => {
          process.kill();
          reject(new Error('Command timeout'));
        }, options.timeout);
      }
    });
  }
}

