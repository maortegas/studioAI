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

      // Execute using cursor-agent CLI (installed via: curl https://cursor.com/install -fsS | bash)
      // cursor-agent runs in background mode without opening the IDE
      // The prompt includes the complete PRD (idea del proyecto)
      console.log(`[Cursor CLI] Executing ${mode} mode with PRD context using cursor-agent`);
      console.log(`[Cursor CLI] Prompt length: ${prompt.length} characters`);
      
      if (mode === 'plan') {
        // Use cursor-agent CLI (installed via cursor.com/install)
        // Based on help: cursor-agent [options] [command] [prompt...]
        // Use --print for non-interactive mode (prints to console, no IDE)
        command = 'cursor-agent';
        args = [
          '--print',             // Print responses to console (non-interactive mode)
          '--output-format', 'text', // Output as text
          prompt,                // Pass the prompt as argument (includes complete PRD)
        ];
      } else if (mode === 'agent') {
        // Agent mode for autonomous coding tasks
        // Uses cursor-agent in interactive mode to generate and modify code
        command = 'cursor-agent';
        args = [
          '--print',             // Print responses to console
          '--output-format', 'text',
          prompt,                // Coding task prompt
        ];
      } else if (mode === 'patch') {
        command = 'cursor-agent';
        args = [
          '--print',
          '--output-format', 'text',
          prompt,
        ];
      } else if (mode === 'review') {
        command = 'cursor-agent';
        args = [
          '--print',
          '--output-format', 'text',
          prompt,
        ];
      } else {
        return reject(new Error(`Unsupported mode: ${mode}`));
      }

      // Log the command being executed for debugging
      console.log(`[Cursor CLI] Command: ${command} ${args.join(' ').substring(0, 200)}...`);
      
      // Get process.env before creating the spawn process to avoid name conflict
      const nodeProcess = require('process');
      
      // cursor-agent runs in background mode
      // The working directory is set via spawn cwd option, not as argument
      const env = {
        ...nodeProcess.env,
        PWD: projectPath, // Set PWD environment variable
      };
      
      const childProcess = spawn(command, args, {
        cwd: projectPath, // Set working directory here, not as --cwd argument
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
        detached: false,
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
        // Check for resource_exhausted in error output
        const hasResourceExhausted = errorOutput.includes('resource_exhausted') || 
                                      errorOutput.includes('ConnectError') ||
                                      output.includes('resource_exhausted') ||
                                      output.includes('ConnectError');
        
        if (code === 0 && !hasResourceExhausted) {
          resolve({
            success: true,
            output,
            error: errorOutput || undefined,
          });
        } else {
          // If resource_exhausted is detected, include it in error
          const errorMsg = hasResourceExhausted 
            ? `resource_exhausted: ${errorOutput || output || `cursor-agent exited with code ${code}`}`
            : (errorOutput || `cursor-agent exited with code ${code}`);
          
          resolve({
            success: false,
            output,
            error: errorMsg,
          });
        }
      });

      childProcess.on('error', (error) => {
        // Log the error for debugging
        console.error(`[Cursor CLI] Process error:`, error);
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

