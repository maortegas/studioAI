import { spawn } from 'child_process';
import { AIProvider, AIMode } from '@devflow-studio/shared';
import { EventEmitter } from 'events';

export interface CLIResult {
  success: boolean;
  output: string;
  error?: string;
}

export class CursorCLI extends EventEmitter {
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

      // Note: This is a placeholder - actual Cursor CLI commands may vary
      // Adjust based on actual Cursor CLI interface
      if (mode === 'plan') {
        command = 'cursor';
        args = ['plan', '--prompt', prompt, '--project', projectPath];
      } else if (mode === 'patch') {
        command = 'cursor';
        args = ['patch', '--prompt', prompt, '--project', projectPath];
      } else if (mode === 'review') {
        command = 'cursor';
        args = ['review', '--prompt', prompt, '--project', projectPath];
      } else {
        return reject(new Error(`Unsupported mode: ${mode}`));
      }

      const process = spawn(command, args, {
        cwd: projectPath,
        shell: true,
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

