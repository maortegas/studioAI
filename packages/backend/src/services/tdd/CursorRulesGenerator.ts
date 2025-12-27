import * as fs from 'fs/promises';
import * as path from 'path';
import { ensureDirectory } from '../../utils/fileSystem';

export class CursorRulesGenerator {
  /**
   * Create .cursorrules file with TDD session rules
   */
  async createCursorRules(
    projectPath: string,
    testCount: number,
    allowedDirs: string[]
  ): Promise<void> {
    try {
      const rulesFilePath = path.join(projectPath, '.cursorrules');
      
      const lines: string[] = [];

      lines.push('# .cursorrules\n\n');
      lines.push('## TDD Session Rules\n\n');
      lines.push('You are in a TDD coding session. Follow STRICTLY:\n\n');

      // Locked Scope Section
      lines.push('### LOCKED SCOPE\n');
      lines.push(`- EXACTLY ${testCount} tests in .tdd-context.md\n`);
      lines.push('- CANNOT add/modify tests\n');
      lines.push('- CANNOT change test locations\n');
      lines.push('- Tests are FINAL and LOCKED\n\n');

      // Constraints Section
      lines.push('### CONSTRAINTS\n');
      lines.push('- Implement ONLY to pass defined tests\n');
      lines.push('- Keep all tests passing\n');
      lines.push('- NO refactor until ALL tests green\n');
      lines.push('- Follow RFC Contract specifications\n');
      lines.push('- Maintain code quality standards\n\n');

      // File Locations Section
      lines.push('### FILE LOCATIONS\n');
      lines.push('**Implementation:**\n');
      allowedDirs.forEach(dir => {
        lines.push(`- ${dir}\n`);
      });
      lines.push('\n');
      lines.push('**Tests:**\n');
      lines.push('- tests/unit/\n\n');

      // Validation Section
      lines.push('### VALIDATION\n');
      lines.push('- Read .tdd-context.md before each action\n');
      lines.push('- Check .tdd-state.json for state\n');
      lines.push('- Verify .tdd-rules.json constraints\n');
      lines.push('- All changes validated before commit\n\n');

      // Prohibited Actions Section
      lines.push('### PROHIBITED\n');
      lines.push('- ❌ Generating new tests\n');
      lines.push('- ❌ Changing architecture\n');
      lines.push('- ❌ Rewriting working code\n');
      lines.push('- ❌ Modifying locked test files\n');
      lines.push('- ❌ Implementing features outside test scope\n');
      lines.push('- ❌ Breaking passing tests\n\n');

      // Context Files Reference
      lines.push('### CONTEXT FILES\n');
      lines.push('Read these files in project root:\n');
      lines.push('1. `.tdd-context.md` - Locked tests and constraints\n');
      lines.push('2. `.tdd-rules.json` - Validation rules\n');
      lines.push('3. `.tdd-state.json` - Current session state\n');
      lines.push('4. `.cursorrules` - This file (behavioral rules)\n\n');

      // Workflow Section
      lines.push('### WORKFLOW\n');
      lines.push('1. Read .tdd-context.md to understand locked tests\n');
      lines.push('2. Check .tdd-state.json for current progress\n');
      lines.push('3. Implement code to pass ALL tests\n');
      lines.push('4. Verify all tests pass\n');
      lines.push('5. Update state if needed\n\n');

      // Write file
      await ensureDirectory(path.dirname(rulesFilePath));
      await fs.writeFile(rulesFilePath, lines.join(''), 'utf8');
      
      console.log(`[TDD-CursorRulesGenerator] ✅ Created .cursorrules at ${rulesFilePath}`);
    } catch (error) {
      console.error('[TDD-CursorRulesGenerator] Error creating cursor rules:', error);
      throw error;
    }
  }
}

