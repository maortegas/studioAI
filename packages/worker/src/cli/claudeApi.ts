import { EventEmitter } from 'events';
import { CLIResult } from './cursor';

/**
 * Claude API implementation as alternative to CLI
 * This can be used when CLI commands open the IDE
 */
export class ClaudeAPI extends EventEmitter {
  private apiKey: string;

  constructor() {
    super();
    // Get API key from environment
    this.apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('[Claude API] No API key found. Set CLAUDE_API_KEY or ANTHROPIC_API_KEY environment variable.');
    }
  }

  async execute(
    mode: string,
    prompt: string,
    projectPath: string,
    options: { timeout?: number } = {}
  ): Promise<CLIResult> {
    if (!this.apiKey) {
      return {
        success: false,
        output: '',
        error: 'Claude API key not configured. Set CLAUDE_API_KEY environment variable.',
      };
    }

    try {
      // Use Anthropic API directly
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: prompt, // PRD completo incluido aquí
            },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          output: '',
          error: `Claude API error: ${error}`,
        };
      }

      const data = await response.json();
      const output = data.content[0]?.text || '';

      // Emit output in chunks for streaming simulation
      this.emit('output', output);

      return {
        success: true,
        output,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message || 'Claude API request failed',
      };
    }
  }
}

