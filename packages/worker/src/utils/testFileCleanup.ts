import fs from 'fs/promises';
import path from 'path';

export interface CleanupResult {
  cleaned: boolean;
  originalSize: number;
  newSize: number;
  issuesFound: string[];
  backupPath?: string;
}

/**
 * Test File Cleanup Service
 * Cleans problematic test files before retry to avoid regenerating the same errors
 */
export class TestFileCleanupService {
  /**
   * Clean a test file before retry
   * - Removes duplicate describe() blocks
   * - Removes conflicting mocks
   * - Creates backup of original file
   */
  static async cleanTestFileForRetry(
    testFilePath: string,
    options: {
      createBackup?: boolean;
      removeFile?: boolean;
    } = {}
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      cleaned: false,
      originalSize: 0,
      newSize: 0,
      issuesFound: [],
    };

    try {
      // Check if file exists
      try {
        await fs.access(testFilePath);
      } catch {
        console.log(`[TestFileCleanup] File does not exist: ${testFilePath}`);
        return result;
      }

      // Read original file
      const originalContent = await fs.readFile(testFilePath, 'utf-8');
      result.originalSize = originalContent.length;

      // Analyze file for issues
      const issues = this.detectTestFileIssues(originalContent);
      result.issuesFound = issues;

      if (issues.length === 0) {
        console.log(`[TestFileCleanup] No issues found in: ${testFilePath}`);
        return result;
      }

      console.log(`[TestFileCleanup] Issues found in ${testFilePath}:`, issues);

      // Create backup if requested
      if (options.createBackup !== false) {
        const backupPath = testFilePath + '.backup';
        await fs.writeFile(backupPath, originalContent, 'utf-8');
        result.backupPath = backupPath;
        console.log(`[TestFileCleanup] Created backup: ${backupPath}`);
      }

      // Remove file if requested (allows AI to regenerate from scratch)
      if (options.removeFile) {
        await fs.unlink(testFilePath);
        result.cleaned = true;
        result.newSize = 0;
        console.log(`[TestFileCleanup] Removed file for regeneration: ${testFilePath}`);
        return result;
      }

      // Otherwise, try to clean the file
      const cleanedContent = this.cleanTestFileContent(originalContent, issues);
      result.newSize = cleanedContent.length;

      if (cleanedContent !== originalContent) {
        await fs.writeFile(testFilePath, cleanedContent, 'utf-8');
        result.cleaned = true;
        console.log(`[TestFileCleanup] Cleaned file: ${testFilePath} (${result.originalSize} → ${result.newSize} bytes)`);
      }

      return result;
    } catch (error: any) {
      console.error(`[TestFileCleanup] Error cleaning file ${testFilePath}:`, error.message);
      return result;
    }
  }

  /**
   * Detect issues in test file content
   */
  private static detectTestFileIssues(content: string): string[] {
    const issues: string[] = [];

    // Issue 1: Multiple describe blocks with the same name
    const describeMatches = content.matchAll(/describe\s*\(\s*['"`]([^'"`]+)['"`]/g);
    const describeNames = new Map<string, number>();
    for (const match of describeMatches) {
      const name = match[1];
      describeNames.set(name, (describeNames.get(name) || 0) + 1);
    }
    for (const [name, count] of describeNames) {
      if (count > 1) {
        issues.push(`duplicate_describe:${name}`);
      }
    }

    // Issue 2: Multiple PrismaClient instantiations
    const prismaClientMatches = content.match(/new\s+PrismaClient\s*\(/g);
    if (prismaClientMatches && prismaClientMatches.length > 1) {
      issues.push('multiple_prisma_instances');
    }

    // Issue 3: Mock hoisting errors (accessing variable before initialization)
    if (content.includes('jest.mock') && content.includes('mockPrisma')) {
      // Check if mockPrisma is used in jest.mock() before it's defined
      const jestMockIndex = content.indexOf('jest.mock');
      const mockPrismaDefIndex = content.indexOf('const mockPrisma');
      if (jestMockIndex > -1 && mockPrismaDefIndex > -1 && jestMockIndex < mockPrismaDefIndex) {
        const mockUsageInJestMock = content.substring(jestMockIndex, mockPrismaDefIndex).includes('mockPrisma');
        if (mockUsageInJestMock) {
          issues.push('mock_hoisting_error');
        }
      }
    }

    // Issue 4: Mixing mocks with real database connections
    const hasMocks = content.includes('jest.mock') || content.includes('.mockResolvedValue') || content.includes('.mockRejectedValue');
    const hasRealDB = content.includes('new PrismaClient()') && !content.includes('jest.mock(\'@prisma/client\'');
    if (hasMocks && hasRealDB) {
      issues.push('mixed_mock_real_db');
    }

    // Issue 5: Very long file (likely contains multiple test approaches)
    const lines = content.split('\n').length;
    if (lines > 300) {
      issues.push('excessive_length');
    }

    return issues;
  }

  /**
   * Clean test file content based on detected issues
   */
  private static cleanTestFileContent(content: string, issues: string[]): string {
    let cleaned = content;

    // Strategy: If serious issues detected, keep only the first describe block
    const hasDuplicateDescribe = issues.some(i => i.startsWith('duplicate_describe:'));
    const hasMockIssues = issues.includes('mock_hoisting_error') || issues.includes('mixed_mock_real_db');
    const hasMultiplePrisma = issues.includes('multiple_prisma_instances');

    if (hasDuplicateDescribe || hasMockIssues || hasMultiplePrisma || issues.includes('excessive_length')) {
      console.log(`[TestFileCleanup] Serious issues detected, keeping only first describe block`);

      // Extract imports
      const importLines: string[] = [];
      const lines = content.split('\n');
      let inImportSection = true;

      for (const line of lines) {
        if (inImportSection) {
          if (line.trim().startsWith('import ') || line.trim().startsWith('//') || line.trim() === '') {
            importLines.push(line);
          } else {
            inImportSection = false;
          }
        }
      }

      // Find first describe block
      const firstDescribeMatch = content.match(/describe\s*\([^)]+\)\s*=>\s*\{[\s\S]*?\n\}\);/);
      if (firstDescribeMatch) {
        // Extract mock setup before first describe
        const beforeDescribe = content.substring(0, content.indexOf(firstDescribeMatch[0]));
        const mockSetup: string[] = [];
        const beforeLines = beforeDescribe.split('\n');

        for (const line of beforeLines) {
          if (line.includes('jest.mock') || line.includes('const mock') || line.includes('= jest.fn()')) {
            mockSetup.push(line);
          }
        }

        // Reconstruct file with imports, mocks, and first describe only
        cleaned = [
          ...importLines,
          '',
          ...mockSetup,
          '',
          firstDescribeMatch[0],
          ''
        ].join('\n');
      }
    }

    return cleaned;
  }

  /**
   * Clean all test files for a coding session before retry
   */
  static async cleanTestFilesForSession(
    projectPath: string,
    testFilePaths: string[],
    options: {
      createBackup?: boolean;
      removeFile?: boolean;
    } = {}
  ): Promise<{ cleaned: number; issues: number }> {
    let cleaned = 0;
    let issues = 0;

    for (const relativePath of testFilePaths) {
      const fullPath = path.join(projectPath, relativePath);
      const result = await this.cleanTestFileForRetry(fullPath, options);

      if (result.issuesFound.length > 0) {
        issues++;
      }

      if (result.cleaned) {
        cleaned++;
      }
    }

    console.log(`[TestFileCleanup] Session cleanup complete: ${cleaned} files cleaned, ${issues} files had issues`);
    return { cleaned, issues };
  }
}
