import { QARepository } from '../repositories/qaRepository';
import { AIService } from './aiService';
import { ProjectRepository } from '../repositories/projectRepository';
import { 
  QASession, 
  CreateQASessionRequest,
  QADashboard,
  TestResult,
  QAReport,
  TestType
} from '@devflow-studio/shared';
import { readFile } from '../utils/fileSystem';
import path from 'path';
import fs from 'fs/promises';

export class QAService {
  private qaRepo: QARepository;
  private aiService: AIService;
  private projectRepo: ProjectRepository;

  constructor() {
    this.qaRepo = new QARepository();
    this.aiService = new AIService();
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Create a QA session (will be automatically executed by worker)
   */
  async createSession(data: CreateQASessionRequest): Promise<QASession> {
    const session = await this.qaRepo.create({
      project_id: data.project_id,
      coding_session_id: data.coding_session_id,
      test_type: data.test_type,
    });

    // If auto_run is true, create AI job for QA execution
    if (data.auto_run !== false) {
      await this.startQASession(session.id);
    }

    return session;
  }

  /**
   * Start QA session execution (creates AI job)
   */
  async startQASession(sessionId: string): Promise<void> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      throw new Error('QA session not found');
    }

    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Build QA prompt
    const prompt = await this.buildQAPrompt(session);

    // Create AI job for QA execution with qa_session_id in args
    const aiJob = await this.aiService.createAIJob({
      project_id: session.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    }, {
      qa_session_id: sessionId,
    });

    // Update session status to running
    await this.qaRepo.update(sessionId, {
      status: 'running',
      started_at: new Date(),
    });
  }

  /**
   * Generate test plan (without running tests) - Creates a plan for user review
   */
  async generateTests(projectId: string, codingSessionId?: string, testType?: TestType): Promise<QASession> {
    const session = await this.qaRepo.create({
      project_id: projectId,
      coding_session_id: codingSessionId,
      test_type: testType,
    });

    // Generate test plan for ALL test types (not just integration)
    const { IntegrationTestPlanService } = await import('./integrationTestPlanService');
    const planService = new IntegrationTestPlanService();
    await planService.generatePlan({
        project_id: projectId,
      coding_session_id: codingSessionId,
        qa_session_id: session.id,
      test_type: testType || 'unit',
    });

    // Update session status to pending (not running - waiting for user approval)
    await this.qaRepo.update(session.id, {
      status: 'pending',
    });

    return session;
  }

  /**
   * Build test generation prompt for a specific story/functionality
   */
  private async buildTestGenerationPromptForStory(
    projectId: string, 
    story: any | null, 
    codingSessionId?: string,
    testType?: TestType
  ): Promise<string> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const stack = project.tech_stack || 'Java/Spring Boot';
    const lines: string[] = [];
    
    if (story) {
      // Generate tests for specific functionality
      lines.push(`Generate tests for: ${story.title}`);
      if (story.description) {
        // Use only first 200 chars of description to keep prompt small
        const desc = story.description.substring(0, 200);
        lines.push(`Functionality: ${desc}`);
      }
    } else {
      // General tests
      lines.push(`Generate general test suite for ${project.name}`);
    }
    
    lines.push(`Stack: ${stack}`);
    
    // Build prompt based on test type
    if (testType === 'unit') {
      lines.push(`Create UNIT tests only. Test individual functions, methods, and components in isolation. Mock all external dependencies.`);
    } else if (testType === 'integration') {
      lines.push(`Create INTEGRATION tests only. Test API endpoints, database interactions, and service integrations.`);
    } else if (testType === 'e2e') {
      lines.push(`Create END-TO-END (E2E) tests only. Test complete user flows from start to finish. Use tools like Cypress, Playwright, or Selenium.`);
    } else if (testType === 'contract') {
      lines.push(`Create CONTRACT tests (consumer/provider) only. Test API contracts between services. Use tools like Pact or similar contract testing frameworks.`);
    } else if (testType === 'load') {
      lines.push(`Create LOAD/PERFORMANCE tests only for CRITICAL processes. Test system performance under load for critical endpoints and processes. Use tools like JMeter, k6, or Gatling. Focus only on performance-critical functionality.`);
    } else {
      // Default: generate unit and integration tests
    lines.push(`Create unit tests (services) and integration tests (REST endpoints) for this functionality.`);
    }
    
    lines.push(`Output JSON: {"summary":{"total":0,"passed":0,"failed":0,"skipped":0},"tests":[{"name":"test","type":"${testType || 'unit|integration'}","status":"passed","duration":100}],"test_code":"// test code","recommendations":["rec"]}`);

    return lines.join(' ');
  }

  /**
   * Build QA prompt for AI execution
   */
  private async buildQAPrompt(session: QASession): Promise<string> {
    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    const lines: string[] = [];

    lines.push(`# Automated QA Testing Task\n`);
    lines.push(`**Project**: ${project.name}\n`);
    lines.push(`**Tech Stack**: ${project.tech_stack || 'Not specified'}\n\n`);

    lines.push(`## Instructions\n`);
    lines.push(`You are an automated QA engineer. Your task is to:\n`);
    lines.push(`1. Analyze the codebase structure\n`);
    
    // Build instructions based on test type
    if (session.test_type === 'unit') {
      lines.push(`2. Generate and execute UNIT tests:\n`);
      lines.push(`   - Test individual functions, methods, and components in isolation\n`);
      lines.push(`   - Mock all external dependencies (databases, APIs, services)\n`);
      lines.push(`   - Focus on business logic and edge cases\n`);
    } else if (session.test_type === 'integration') {
      lines.push(`2. Generate and execute INTEGRATION tests:\n`);
      lines.push(`   - Test API endpoints and their interactions\n`);
      lines.push(`   - Test database operations and transactions\n`);
      lines.push(`   - Test service-to-service communication\n`);
    } else if (session.test_type === 'e2e') {
      lines.push(`2. Generate and execute END-TO-END (E2E) tests:\n`);
      lines.push(`   - Test complete user flows from start to finish\n`);
      lines.push(`   - Test critical business scenarios\n`);
      lines.push(`   - Use browser automation tools (Cypress, Playwright, Selenium)\n`);
    } else if (session.test_type === 'contract') {
      lines.push(`2. Generate and execute CONTRACT tests:\n`);
      lines.push(`   - Test API contracts between consumer and provider services\n`);
      lines.push(`   - Verify request/response schemas match expectations\n`);
      lines.push(`   - Use contract testing tools (Pact, Spring Cloud Contract)\n`);
    } else if (session.test_type === 'load') {
      lines.push(`2. Generate and execute LOAD/PERFORMANCE tests for CRITICAL processes only:\n`);
      lines.push(`   - Test system performance under various load conditions for critical processes\n`);
      lines.push(`   - Measure response times, throughput, and resource usage\n`);
      lines.push(`   - Use load testing tools (JMeter, k6, Gatling)\n`);
    } else {
      // Default: comprehensive test suite
    lines.push(`2. Generate comprehensive test suites:\n`);
    lines.push(`   - Unit tests for individual functions/components\n`);
    lines.push(`   - Integration tests for API endpoints and services\n`);
    lines.push(`   - E2E tests for critical user flows\n`);
    }
    
    lines.push(`3. Execute the tests and report results\n`);
    lines.push(`4. Calculate code coverage if possible\n`);
    lines.push(`5. Provide recommendations for improvements\n\n`);

    if (session.coding_session_id) {
      lines.push(`**Note**: This QA session is for a specific coding session. Focus on testing the recently implemented features.\n\n`);
    }

    lines.push(`## Output Format\n`);
    lines.push(`**CRITICAL INSTRUCTIONS:**\n`);
    lines.push(`1. You MUST include the complete JSON results directly in your response\n`);
    lines.push(`2. Do NOT mention creating files, saving files, or file names\n`);
    lines.push(`3. Do NOT just describe the results - you MUST include the actual JSON object\n`);
    lines.push(`4. Your response must contain a \`\`\`json code block with the complete results\n`);
    lines.push(`5. Start your response with the JSON results, not with descriptions\n\n`);
    lines.push(`Provide test results in the following JSON format:\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`{\n`);
    lines.push(`  "summary": {\n`);
    lines.push(`    "total": 0,\n`);
    lines.push(`    "passed": 0,\n`);
    lines.push(`    "failed": 0,\n`);
    lines.push(`    "skipped": 0,\n`);
    lines.push(`    "coverage": 0\n`);
    lines.push(`  },\n`);
    lines.push(`  "tests": [\n`);
    lines.push(`    {\n`);
    lines.push(`      "name": "test name",\n`);
    lines.push(`      "type": "unit|integration|e2e",\n`);
    lines.push(`      "status": "passed|failed|skipped",\n`);
    lines.push(`      "duration": 100,\n`);
    lines.push(`      "error": "error message if failed"\n`);
    lines.push(`    }\n`);
    lines.push(`  ],\n`);
    lines.push(`  "recommendations": ["recommendation 1", "recommendation 2"]\n`);
    lines.push(`}\n`);
    lines.push(`\`\`\`\n\n`);
    lines.push(`**FINAL REMINDER: Your response MUST start with or contain the complete JSON object in a \`\`\`json code block. Do NOT write descriptions before the JSON. Start directly with the \`\`\`json block.**\n\n`);

    return lines.join('\n');
  }

  /**
   * Process QA results from AI output (called by worker)
   */
  async processResults(sessionId: string, aiOutput: string): Promise<void> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      throw new Error('QA session not found');
    }

    try {
      // Parse JSON from AI output
      const jsonMatch = aiOutput.match(/```json\s*([\s\S]*?)\s*```/) || 
                       aiOutput.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in AI output');
      }

      const qaData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      const summary = qaData.summary || {};
      const tests = qaData.tests || [];

      // Save test results
      for (const test of tests) {
        await this.qaRepo.addTestResult(sessionId, {
          test_name: test.name || 'Unknown test',
          test_type: test.type || 'unit',
          status: test.status || 'skipped',
          duration: test.duration,
          error_message: test.error,
          output: JSON.stringify(test),
        });
      }

      // Update session
      await this.qaRepo.update(sessionId, {
        status: summary.failed > 0 ? 'completed' : 'completed',
        total_tests: summary.total || tests.length,
        passed_tests: summary.passed || tests.filter((t: any) => t.status === 'passed').length,
        failed_tests: summary.failed || tests.filter((t: any) => t.status === 'failed').length,
        skipped_tests: summary.skipped || tests.filter((t: any) => t.status === 'skipped').length,
        coverage_percentage: summary.coverage,
        completed_at: new Date(),
      });

      // Save report to file
      const project = await this.projectRepo.findById(session.project_id);
      if (project) {
        const reportPath = path.join(project.base_path, 'artifacts', `QA_REPORT_${sessionId}.json`);
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(qaData, null, 2), 'utf8');
        
        await this.qaRepo.update(sessionId, {
          report_path: `artifacts/QA_REPORT_${sessionId}.json`,
        });
      }
    } catch (error: any) {
      console.error('Error processing QA results:', error);
      await this.qaRepo.update(sessionId, {
        status: 'failed',
        completed_at: new Date(),
      });
      throw error;
    }
  }

  /**
   * Get QA dashboard
   */
  async getDashboard(projectId: string): Promise<QADashboard> {
    return await this.qaRepo.getDashboard(projectId);
  }

  /**
   * Get QA session with test results
   */
  async getSession(sessionId: string): Promise<QAReport | null> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      return null;
    }

    const testResults = await this.qaRepo.getTestResults(sessionId);

    return {
      session_id: sessionId,
      project_id: session.project_id,
      summary: {
        total: session.total_tests,
        passed: session.passed_tests,
        failed: session.failed_tests,
        skipped: session.skipped_tests,
        coverage: session.coverage_percentage,
      },
      test_results: testResults,
      created_at: session.created_at,
    };
  }

  /**
   * Get all sessions for a project
   */
  async getProjectSessions(projectId: string): Promise<QASession[]> {
    return await this.qaRepo.findByProjectId(projectId);
  }

  /**
   * Get list of test files for a QA session
   */
  async getTestFiles(sessionId: string): Promise<{ name: string; path: string; size: number }[]> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      throw new Error('QA session not found');
    }

    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    const testDir = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`);
    
    try {
      const files = await fs.readdir(testDir);
      const testFiles = [];

      for (const file of files) {
        if (file.endsWith('.js')) {
          const filePath = path.join(testDir, file);
          const stats = await fs.stat(filePath);
          testFiles.push({
            name: file,
            path: `artifacts/TESTS_${sessionId}/${file}`,
            size: stats.size,
          });
        }
      }

      return testFiles;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []; // Directory doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Get content of a test file
   */
  async getTestFileContent(sessionId: string, fileName: string): Promise<string> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      throw new Error('QA session not found');
    }

    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Sanitize filename to prevent path traversal
    const sanitizedFileName = path.basename(fileName);
    const testFilePath = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`, sanitizedFileName);

    // Verify the file is in the test directory
    const testDir = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`);
    if (!testFilePath.startsWith(testDir)) {
      throw new Error('Invalid file path');
    }

    try {
      const content = await fs.readFile(testFilePath, 'utf8');
      return content;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error('Test file not found');
      }
      throw error;
    }
  }

  /**
   * Update/edit a test file
   */
  async updateTestFile(sessionId: string, fileName: string, content: string): Promise<void> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      throw new Error('QA session not found');
    }

    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Sanitize filename to prevent path traversal
    const sanitizedFileName = path.basename(fileName);
    const testFilePath = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`, sanitizedFileName);

    // Verify the file is in the test directory
    const testDir = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`);
    if (!testFilePath.startsWith(testDir)) {
      throw new Error('Invalid file path');
    }

    // Ensure directory exists
    await fs.mkdir(testDir, { recursive: true });

    // Write the updated content
    await fs.writeFile(testFilePath, content, 'utf8');

    // If this is an individual test file, also update the consolidated file
    if (sanitizedFileName !== 'all_tests.js') {
      await this.updateConsolidatedTestFile(sessionId, project.base_path);
    }
  }

  /**
   * Delete a test file
   */
  async deleteTestFile(sessionId: string, fileName: string): Promise<void> {
    const session = await this.qaRepo.findById(sessionId);
    if (!session) {
      throw new Error('QA session not found');
    }

    const project = await this.projectRepo.findById(session.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Sanitize filename to prevent path traversal
    const sanitizedFileName = path.basename(fileName);
    const testFilePath = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`, sanitizedFileName);

    // Verify the file is in the test directory
    const testDir = path.join(project.base_path, 'artifacts', `TESTS_${sessionId}`);
    if (!testFilePath.startsWith(testDir)) {
      throw new Error('Invalid file path');
    }

    // Don't allow deleting the consolidated file
    if (sanitizedFileName === 'all_tests.js') {
      throw new Error('Cannot delete consolidated test file');
    }

    try {
      await fs.unlink(testFilePath);
      
      // Update consolidated file after deletion
      await this.updateConsolidatedTestFile(sessionId, project.base_path);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error('Test file not found');
      }
      throw error;
    }
  }

  /**
   * Rebuild consolidated test file from individual test files
   */
  private async updateConsolidatedTestFile(sessionId: string, projectBasePath: string): Promise<void> {
    const testDir = path.join(projectBasePath, 'artifacts', `TESTS_${sessionId}`);
    const consolidatedPath = path.join(testDir, 'all_tests.js');

    try {
      const files = await fs.readdir(testDir);
      const testFiles = files.filter(f => f.endsWith('.js') && f !== 'all_tests.js').sort();

      let consolidatedContent = '';
      let index = 0;

      for (const file of testFiles) {
        const filePath = path.join(testDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const separator = `\n\n// ===== Tests from ${file} =====\n\n`;
        consolidatedContent += separator + content;
        index++;
      }

      await fs.writeFile(consolidatedPath, consolidatedContent, 'utf8');
    } catch (error: any) {
      console.error('Error updating consolidated test file:', error);
      // Don't throw, just log the error
    }
  }
}
