/**
 * AgentDB Rules Manager
 * 
 * Manages TDD rules using AgentDB instead of file-based JSON storage.
 * Replaces TDDRulesValidator functionality with persistent database storage.
 */

import { AgentDBService, AgentDBInstance } from './AgentDBService';

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

export interface TDDRules {
  session_id: string;
  locked: boolean;
  rules: {
    tests: {
      count: number;
      locked: boolean;
      files: string[];
      message: string;
    };
    implementation: {
      allowed_directories: string[];
      forbidden_actions: string[];
    };
    scope: {
      story_id: string;
      story_title: string;
      features: string[];
      out_of_scope: string[];
    };
  };
  validation: {
    pre_commit: boolean;
    block_on_violation: boolean;
  };
}

export class AgentDBRulesManager {
  private agentdbService: AgentDBService;
  private instance: AgentDBInstance | null = null;
  private sessionId: string;
  private projectPath: string;

  constructor(projectPath: string, sessionId: string) {
    this.agentdbService = new AgentDBService();
    this.projectPath = projectPath;
    this.sessionId = sessionId;
  }

  /**
   * Ensure instance is established
   */
  private async ensureInstance(): Promise<AgentDBInstance> {
    if (!this.instance) {
      console.log(`[AgentDBRulesManager] Getting AgentDB instance for project: ${this.projectPath}, session: ${this.sessionId}`);
      try {
        this.instance = await this.agentdbService.getInstance(this.projectPath, this.sessionId);
        console.log(`[AgentDBRulesManager] ✅ AgentDB instance obtained successfully`);
      } catch (error: any) {
        console.error(`[AgentDBRulesManager] ❌ Error getting AgentDB instance:`, error.message);
        console.error(`[AgentDBRulesManager] Error stack:`, error.stack);
        throw error;
      }
    }
    return this.instance;
  }

  /**
   * Create rules in AgentDB
   */
  async createRules(
    sessionId: string,
    tests: Array<{ name: string; code: string }>,
    story: any
  ): Promise<void> {
    try {
      const instance = await this.ensureInstance();

      // Extract test file paths from test code
      const testFiles: string[] = [];
      const testFileRegex = /(?:file|path|location)[:\s]+['"]?([^'"]+\.(test|spec)\.(js|ts|jsx|tsx))['"]?/gi;
      
      for (const test of tests) {
        const matches = test.code.matchAll(testFileRegex);
        for (const match of matches) {
          if (match[1] && !testFiles.includes(match[1])) {
            testFiles.push(match[1]);
          }
        }
      }

      // If no test files found in code, use default pattern
      if (testFiles.length === 0) {
        // Try to extract the main file/module name from the story title
        // Common patterns: "Implement X", "Create X service", etc.
        let fileName = '';
        
        // Pattern 1: "Implement/Create/Build X service/controller/component/module"
        const serviceMatch = story.title.match(/(?:implement|create|build|set up|setup)\s+(?:a\s+)?(?:the\s+)?(\w+)(?:\s+service|\s+controller|\s+component|\s+module|\s+class|\s+API|\s+sdk)/i);
        if (serviceMatch) {
          fileName = `${serviceMatch[1]}.test.js`;
        }
        
        // Pattern 2: "X Service implementation", "X Controller"
        const entityMatch = story.title.match(/^(\w+)(?:\s+service|\s+controller|\s+component|\s+module)/i);
        if (!fileName && entityMatch) {
          fileName = `${entityMatch[1]}.test.js`;
        }
        
        // Pattern 3: Look for CamelCase or PascalCase words
        const camelCaseMatch = story.title.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/);
        if (!fileName && camelCaseMatch) {
          const camelCase = camelCaseMatch[1].charAt(0).toLowerCase() + camelCaseMatch[1].slice(1);
          fileName = `${camelCase}.test.js`;
        }
        
        // Fallback: Use sanitized title
        if (!fileName) {
          const sanitizedTitle = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          fileName = `${sanitizedTitle}.test.js`;
        }
        
        testFiles.push(`tests/unit/${fileName}`);
      }

      // Extract features from story (if available)
      const features: string[] = [];
      if (story.related_feature) {
        features.push(story.related_feature);
      }

      const rules: TDDRules = {
        session_id: sessionId,
        locked: true,
        rules: {
          tests: {
            count: tests.length,
            locked: true,
            files: testFiles,
            message: 'Tests are LOCKED. Cannot modify.'
          },
          implementation: {
            allowed_directories: ['src/services', 'src/models', 'src/utils', 'src/controllers', 'src/routes'],
            forbidden_actions: [
              'Rewriting existing working code',
              'Changing architecture approach',
              'Modifying locked test files',
              'Generating new tests',
              'Removing passing tests'
            ]
          },
          scope: {
            story_id: story.id,
            story_title: story.title,
            features: features,
            out_of_scope: []
          }
        },
        validation: {
          pre_commit: true,
          block_on_violation: true
        }
      };

      await this.agentdbService.executeStatement(
        instance,
        `INSERT OR REPLACE INTO tdd_rules (session_id, rules_json, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [sessionId, JSON.stringify(rules)]
      );

      console.log(`[AgentDBRulesManager] ✅ Created rules in AgentDB for session ${sessionId}`);
    } catch (error) {
      console.error('[AgentDBRulesManager] Error creating rules:', error);
      throw error;
    }
  }

  /**
   * Validate file changes against rules
   */
  async validateChanges(changedFiles: string[]): Promise<ValidationResult> {
    try {
      const rules = await this.getRules();
      
      if (!rules) {
        return { valid: true, violations: [] }; // No rules, allow all
      }

      const violations: string[] = [];

      // Check if rules are locked
      if (rules.locked) {
        // Validate against locked test files
        if (rules.rules?.tests?.locked && rules.rules?.tests?.files) {
          for (const changedFile of changedFiles) {
            for (const lockedFile of rules.rules.tests.files) {
              if (changedFile.includes(lockedFile) || lockedFile.includes(changedFile)) {
                violations.push(`Cannot modify locked test file: ${lockedFile}`);
              }
            }
          }
        }

        // Validate against allowed directories
        if (rules.rules?.implementation?.allowed_directories) {
          const allowedDirs = rules.rules.implementation.allowed_directories;
          for (const changedFile of changedFiles) {
            // Check if file is in an allowed directory
            const isAllowed = allowedDirs.some(dir => changedFile.startsWith(dir));
            if (!isAllowed && !changedFile.includes('node_modules') && !changedFile.includes('.git')) {
              // Allow if it's a test file being created (not modified)
              if (!changedFile.match(/\.(test|spec)\.(js|ts|jsx|tsx)$/)) {
                violations.push(`File ${changedFile} is outside allowed directories: ${allowedDirs.join(', ')}`);
              }
            }
          }
        }
      }

      return {
        valid: violations.length === 0,
        violations
      };
    } catch (error) {
      console.error('[AgentDBRulesManager] Error validating changes:', error);
      return { valid: false, violations: ['Error validating changes'] };
    }
  }

  /**
   * Get current rules object
   */
  async getRules(): Promise<TDDRules | null> {
    try {
      const instance = await this.ensureInstance();

      const result = await this.agentdbService.executeQuery(
        instance,
        `SELECT rules_json FROM tdd_rules WHERE session_id = ?`,
        [this.sessionId]
      );

      if (result && result.length > 0) {
        const rulesJson = result[0].rules_json;
        return JSON.parse(rulesJson) as TDDRules;
      }

      return null;
    } catch (error: any) {
      console.error('[AgentDBRulesManager] Error reading rules:', error);
      return null;
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }
}
