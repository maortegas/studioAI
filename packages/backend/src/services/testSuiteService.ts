import { TestSuiteRepository } from '../repositories/testSuiteRepository';
import { ProjectRepository } from '../repositories/projectRepository';
import { 
  TestSuite, 
  CreateTestSuiteRequest, 
  UpdateTestSuiteRequest,
  TestSuiteWithExecutions,
  TestExecution
} from '@devflow-studio/shared';
import path from 'path';
import fs from 'fs/promises';

export class TestSuiteService {
  private testSuiteRepo: TestSuiteRepository;
  private projectRepo: ProjectRepository;

  constructor() {
    this.testSuiteRepo = new TestSuiteRepository();
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Create a test suite for a coding session
   */
  async createTestSuite(data: CreateTestSuiteRequest): Promise<TestSuite> {
    return await this.testSuiteRepo.create(data);
  }

  /**
   * Get test suites for a coding session
   */
  async getTestSuitesForSession(codingSessionId: string): Promise<TestSuiteWithExecutions[]> {
    const suites = await this.testSuiteRepo.findByCodingSession(codingSessionId);
    
    const suitesWithExecutions: TestSuiteWithExecutions[] = [];
    for (const suite of suites) {
      const executions = await this.testSuiteRepo.getExecutions(suite.id);
      suitesWithExecutions.push({
        ...suite,
        executions,
        last_execution: executions[0] || undefined,
      });
    }
    
    return suitesWithExecutions;
  }

  /**
   * Get test suite by ID with executions
   */
  async getTestSuite(id: string): Promise<TestSuiteWithExecutions | null> {
    const suite = await this.testSuiteRepo.findById(id);
    if (!suite) {
      return null;
    }

    const executions = await this.testSuiteRepo.getExecutions(id);
    return {
      ...suite,
      executions,
      last_execution: executions[0] || undefined,
    };
  }

  /**
   * Update test suite (e.g., after generation or manual edit)
   */
  async updateTestSuite(id: string, data: UpdateTestSuiteRequest): Promise<TestSuite | null> {
    return await this.testSuiteRepo.update(id, data);
  }

  /**
   * Save test code to file system
   * For TDD: uses traditional structure (tests/unit/) with one file per functionality
   */
  async saveTestCodeToFile(suiteId: string, testCode: string): Promise<string> {
    const suite = await this.testSuiteRepo.findById(suiteId);
    if (!suite) {
      throw new Error('Test suite not found');
    }

    const project = await this.projectRepo.findById(suite.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // For TDD (when coding_session_id exists), use traditional structure: tests/unit/
    if (suite.coding_session_id && suite.story_id) {
      // Get story/task title for file naming
      const { Pool } = await import('pg');
      const pool = (await import('../config/database')).default;
      const storyResult = await pool.query('SELECT title, description FROM tasks WHERE id = $1', [suite.story_id]);
      
      let storyTitle = 'default';
      let storyDescription = '';
      if (storyResult.rows.length > 0) {
        storyTitle = storyResult.rows[0].title;
        storyDescription = storyResult.rows[0].description || '';
      }
      
      // Try to extract the main file/module name from the story title
      // Common patterns: "Implement X", "Create X service", "Set up X", "Build X component"
      // Goal: Extract the core entity name (e.g., "whatsappService", "userController")
      let fileName = '';
      
      // Pattern 1: "Implement/Create/Build X service/controller/component/module"
      const serviceMatch = storyTitle.match(/(?:implement|create|build|set up|setup)\s+(?:a\s+)?(?:the\s+)?(\w+)(?:\s+service|\s+controller|\s+component|\s+module|\s+class|\s+API|\s+sdk)/i);
      if (serviceMatch) {
        fileName = `${serviceMatch[1]}.test.js`;
      }
      
      // Pattern 2: "X Service implementation", "X Controller"
      const entityMatch = storyTitle.match(/^(\w+)(?:\s+service|\s+controller|\s+component|\s+module)/i);
      if (!fileName && entityMatch) {
        fileName = `${entityMatch[1]}.test.js`;
      }
      
      // Pattern 3: Check if description mentions specific file names
      const fileInDescMatch = (storyTitle + ' ' + storyDescription).match(/(?:file|module|class)\s+(?:named|called)?\s*[`'"']?(\w+\.\w+)[`'"']?/i);
      if (!fileName && fileInDescMatch) {
        // Extract filename without extension and use it
        const baseName = fileInDescMatch[1].replace(/\.\w+$/, '');
        fileName = `${baseName}.test.js`;
      }
      
      // Pattern 4: Look for CamelCase or PascalCase words that look like class/file names
      const camelCaseMatch = storyTitle.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/);
      if (!fileName && camelCaseMatch) {
        // Convert PascalCase to camelCase for file naming
        const camelCase = camelCaseMatch[1].charAt(0).toLowerCase() + camelCaseMatch[1].slice(1);
        fileName = `${camelCase}.test.js`;
      }
      
      // Fallback: Use sanitized title (current behavior)
      if (!fileName) {
        const sanitizedTitle = storyTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        fileName = `${sanitizedTitle}.test.js`;
      }
      
      console.log(`[TestSuiteService] Generated test filename: ${fileName} from story: "${storyTitle}"`);
      
      // Use traditional TDD structure: tests/unit/
      const unitTestDir = path.join(project.base_path, 'tests', 'unit');
      await fs.mkdir(unitTestDir, { recursive: true });
      
      const filePath = path.join(unitTestDir, fileName);
      
      // If file exists, append tests (traditional TDD: iterate on same file)
      let finalTestCode = testCode;
      try {
        const existingContent = await fs.readFile(filePath, 'utf8');
        finalTestCode = existingContent + '\n\n' + testCode;
        console.log(`[TestSuiteService] Appending tests to existing file: ${filePath}`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // File doesn't exist, create new one
        console.log(`[TestSuiteService] Creating new test file: ${filePath}`);
      }
      
      await fs.writeFile(filePath, finalTestCode, 'utf8');
      
      // Update suite with file path
      await this.testSuiteRepo.update(suiteId, {
        file_path: `tests/unit/${fileName}`,
        test_code: finalTestCode,
        status: 'ready',
        generated_at: new Date(),
      });
      
      return filePath;
    } else {
      // General test file (non-TDD)
      const testDir = path.join(project.base_path, 'tests');
      await fs.mkdir(testDir, { recursive: true });
      const fileName = `${suite.test_type}_${suite.name.replace(/\s+/g, '_')}.test.js`;
      const filePath = path.join(testDir, fileName);
      await fs.writeFile(filePath, testCode, 'utf8');
      
      await this.testSuiteRepo.update(suiteId, {
        file_path: `tests/${fileName}`,
        test_code: testCode,
        status: 'ready',
        generated_at: new Date(),
      });
      
      return filePath;
    }
  }

  /**
   * Execute a test suite
   */
  async executeTestSuite(suiteId: string, executionType: 'auto' | 'manual' = 'auto'): Promise<TestExecution> {
    const suite = await this.testSuiteRepo.findById(suiteId);
    if (!suite) {
      throw new Error('Test suite not found');
    }

    if (suite.status !== 'ready') {
      throw new Error('Test suite is not ready for execution');
    }

    const project = await this.projectRepo.findById(suite.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create execution record
    const execution = await this.testSuiteRepo.createExecution({
      test_suite_id: suiteId,
      execution_type: executionType,
      status: 'running',
    });

    // Update suite status
    await this.testSuiteRepo.update(suiteId, { status: 'running' });

    // Execute tests based on project tech stack
    try {
      const result = await this.runTests(project, suite);
      
      // Update execution with results
      await this.testSuiteRepo.updateExecution(execution.id, {
        status: result.status,
        completed_at: new Date(),
        duration: result.duration,
        total_tests: result.total_tests,
        passed_tests: result.passed_tests,
        failed_tests: result.failed_tests,
        skipped_tests: result.skipped_tests,
        output: result.output,
        error_message: result.error,
      });

      // Update suite status
      await this.testSuiteRepo.update(suiteId, {
        status: result.status === 'passed' ? 'passed' : 'failed',
        executed_at: new Date(),
        execution_result: result,
      });

      return await this.testSuiteRepo.getExecutions(suiteId).then(execs => execs[0]);
    } catch (error: any) {
      await this.testSuiteRepo.updateExecution(execution.id, {
        status: 'error',
        completed_at: new Date(),
        error_message: error.message,
      });

      await this.testSuiteRepo.update(suiteId, {
        status: 'failed',
        executed_at: new Date(),
      });

      throw error;
    }
  }

  /**
   * Run tests based on project tech stack
   */
  private async runTests(project: any, suite: TestSuite): Promise<{
    status: 'passed' | 'failed' | 'error';
    duration: number;
    total_tests: number;
    passed_tests: number;
    failed_tests: number;
    skipped_tests: number;
    output: string;
    error?: string;
  }> {
    const startTime = Date.now();
    const techStack = project.tech_stack?.toLowerCase() || '';

    // Determine test runner command based on tech stack
    let command: string;
    let args: string[];

    if (techStack.includes('java') || techStack.includes('spring')) {
      // Java/Spring Boot - use Maven or Gradle
      command = 'mvn';
      args = ['test', '-Dtest=' + suite.name];
    } else if (techStack.includes('javascript') || techStack.includes('typescript') || techStack.includes('node')) {
      // Node.js - use Jest, Mocha, or npm test
      command = 'npm';
      args = ['test', '--', suite.file_path || ''];
    } else if (techStack.includes('python')) {
      // Python - use pytest
      command = 'pytest';
      args = [suite.file_path || ''];
    } else {
      // Default: try npm test
      command = 'npm';
      args = ['test'];
    }

    // For now, return a mock result
    // In production, this would execute the actual test command
    const duration = Date.now() - startTime;
    
    return {
      status: 'passed', // Would be determined by actual execution
      duration,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      skipped_tests: 0,
      output: 'Test execution would run here',
    };
  }

  /**
   * Delete a test suite
   */
  async deleteTestSuite(id: string): Promise<void> {
    const suite = await this.testSuiteRepo.findById(id);
    if (suite && suite.file_path) {
      const project = await this.projectRepo.findById(suite.project_id);
      if (project) {
        const filePath = path.join(project.base_path, suite.file_path);
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // File might not exist, continue with deletion
        }
      }
    }
    
    await this.testSuiteRepo.delete(id);
  }
}
