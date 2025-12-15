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
      // Claude CLI real commands - adjust based on actual CLI interface
      // The prompt includes the complete PRD (idea del proyecto)
      console.log(`[Claude CLI] Executing ${mode} mode with PRD context`);
      console.log(`[Claude CLI] Prompt length: ${prompt.length} characters`);
      
      if (mode === 'plan') {
        // Use Claude CLI with headless mode
        command = 'claude';
        args = [
          '--headless',           // Headless mode - no GUI
          '--no-gui',             // Explicitly disable GUI
          '--batch',              // Batch mode
          '--non-interactive',    // Non-interactive
          mode,
          '--prompt', prompt,     // Complete PRD included here
          '--project', projectPath,
          '--output', 'stdout'    // Output to stdout instead of file
        ];
      } else if (mode === 'patch') {
        command = 'claude';
        args = [
          '--headless',
          '--no-gui',
          '--batch',
          '--non-interactive',
          mode,
          '--prompt', prompt,
          '--project', projectPath,
          '--output', 'stdout'
        ];
      } else if (mode === 'review') {
        command = 'claude';
        args = [
          '--headless',
          '--no-gui',
          '--batch',
          '--non-interactive',
          mode,
          '--prompt', prompt,
          '--project', projectPath,
          '--output', 'stdout'
        ];
      } else {
        return reject(new Error(`Unsupported mode: ${mode}`));
      }

      // Log the command being executed for debugging
      console.log(`[Claude CLI] Command: ${command} ${args.join(' ').substring(0, 200)}...`);
      
      // Get process.env before creating the spawn process to avoid name conflict
      const nodeProcess = require('process');
      
      // Set environment variables to force headless mode
      const env = {
        ...nodeProcess.env,
        CLAUDE_BATCH_MODE: '1',
        CLAUDE_NON_INTERACTIVE: '1',
        CLAUDE_NO_UI: '1',
        CLAUDE_HEADLESS: '1',
        CLAUDE_CLI_MODE: '1',
        DISPLAY: '', // Unset DISPLAY on Linux to prevent GUI
        // On macOS, try to prevent GUI
        ...(process.platform === 'darwin' && {
          __CF_USER_TEXT_ENCODING: nodeProcess.env.__CF_USER_TEXT_ENCODING || '0x1F5:0x0:0x0',
        }),
      };
      
      const childProcess = spawn(command, args, {
        cwd: projectPath,
        shell: false, // Don't use shell to have more control
        stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, capture stdout/stderr
        detached: false, // Don't detach to prevent new windows
        env,
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        this.emit('output', text);
      });

      childProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        this.emit('error', text);
      });

      childProcess.on('close', (code) => {
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

      childProcess.on('error', (error) => {
        reject(error);
      });

      // Timeout handling
      if (options.timeout) {
        setTimeout(() => {
          childProcess.kill();
          reject(new Error('Command timeout'));
        }, options.timeout);
      }
    });
  }
}

