import { IntegrationTestPlanRepository } from '../repositories/integrationTestPlanRepository';
import { AIService } from './aiService';
import { ProjectRepository } from '../repositories/projectRepository';
import { 
  TestPlan,
  TestPlanItem,
  CreateTestPlanRequest,
  UpdateTestPlanRequest,
  TestType
} from '@devflow-studio/shared';

export class IntegrationTestPlanService {
  private planRepo: IntegrationTestPlanRepository;
  private aiService: AIService;
  private projectRepo: ProjectRepository;

  constructor() {
    this.planRepo = new IntegrationTestPlanRepository();
    this.aiService = new AIService();
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Generate test plan using AI (for all test types)
   */
  async generatePlan(data: CreateTestPlanRequest): Promise<TestPlan> {
    const project = await this.projectRepo.findById(data.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Build prompt to generate test plan based on test type
    const prompt = await this.buildPlanGenerationPrompt(data);

    // Create AI job to generate the plan
    const aiJob = await this.aiService.createAIJob({
      project_id: data.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
      skipBundle: true,
    }, {
      phase: 'test_plan_generation',
      qa_session_id: data.qa_session_id,
      coding_session_id: data.coding_session_id,
      test_type: data.test_type,
    });

    // Create plan with empty items initially (will be updated by worker)
    const plan = await this.planRepo.create({
      project_id: data.project_id,
      qa_session_id: data.qa_session_id,
      coding_session_id: data.coding_session_id,
      test_type: data.test_type,
      items: [],
    });

    return plan;
  }

  /**
   * Get plan by ID
   */
  async getPlan(planId: string): Promise<TestPlan | null> {
    return await this.planRepo.findById(planId);
  }

  /**
   * Get plan by QA session
   */
  async getPlanByQASession(qaSessionId: string): Promise<TestPlan | null> {
    return await this.planRepo.findByQASession(qaSessionId);
  }

  /**
   * Get plan by QA session and test type
   */
  async getPlanByQASessionAndType(qaSessionId: string, testType: TestType): Promise<TestPlan | null> {
    return await this.planRepo.findByQASessionAndType(qaSessionId, testType);
  }

  /**
   * Get plan by coding session
   */
  async getPlanByCodingSession(codingSessionId: string): Promise<TestPlan | null> {
    return await this.planRepo.findByCodingSession(codingSessionId);
  }

  /**
   * Update plan (items or status)
   */
  async updatePlan(planId: string, data: UpdateTestPlanRequest): Promise<TestPlan> {
    return await this.planRepo.update(planId, data);
  }

  /**
   * Delete plan
   */
  async deletePlan(planId: string): Promise<void> {
    await this.planRepo.delete(planId);
  }

  /**
   * Execute plan - creates QA session and runs tests
   */
  async executePlan(planId: string): Promise<{ qa_session_id: string; message: string }> {
    const plan = await this.planRepo.findById(planId);
    if (!plan) {
      throw new Error('Test plan not found');
    }

    if (plan.items.length === 0) {
      throw new Error('Cannot execute plan with no test items');
    }

    if (plan.status !== 'approved') {
      throw new Error('Plan must be approved before execution');
    }

    // Create or use existing QA session for execution
    let qaSessionId = plan.qa_session_id;
    if (!qaSessionId) {
      const { QAService } = await import('./qaService');
      const qaService = new QAService();
      
      const qaSession = await qaService.createSession({
        project_id: plan.project_id,
        coding_session_id: plan.coding_session_id,
        test_type: plan.test_type,
        auto_run: false, // We'll start it manually after updating the plan
      });
      qaSessionId = qaSession.id;
    }

    // Update plan with QA session ID and status
    await this.planRepo.update(planId, {
      qa_session_id: qaSessionId,
      status: 'executing',
    });

    // Start QA session with plan items
    await this.startQAWithPlan(qaSessionId, plan);

    return {
      qa_session_id: qaSessionId,
      message: `${plan.test_type} test plan execution started`,
    };
  }

  /**
   * Start QA session with plan items
   */
  private async startQAWithPlan(qaSessionId: string, plan: TestPlan): Promise<void> {
    const project = await this.projectRepo.findById(plan.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Build prompt with plan items
    const prompt = await this.buildExecutionPrompt(plan);

    // Create AI job for QA execution
    const { AIService } = await import('./aiService');
    const aiService = new AIService();
    
    await aiService.createAIJob({
      project_id: plan.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    }, {
      qa_session_id: qaSessionId,
      test_plan_id: plan.id,
      test_type: plan.test_type,
    });

    // Update QA session status
    const { QARepository } = await import('../repositories/qaRepository');
    const qaRepo = new QARepository();
    await qaRepo.update(qaSessionId, {
      status: 'running',
      started_at: new Date(),
    });
  }

  /**
   * Build prompt to generate test plan (for all test types)
   */
  private async buildPlanGenerationPrompt(data: CreateTestPlanRequest): Promise<string> {
    const project = await this.projectRepo.findById(data.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    const testType = data.test_type || 'unit';
    const testTypeLabel = this.getTestTypeLabel(testType);

    const lines: string[] = [];
    lines.push(`# ${testTypeLabel} Test Plan Generation\n`);
    lines.push(`**Project**: ${project.name}\n`);
    lines.push(`**Tech Stack**: ${project.tech_stack || 'Not specified'}\n`);
    lines.push(`**Test Type**: ${testTypeLabel}\n\n`);

    lines.push(`## Task\n`);
    if (testType === 'load') {
      lines.push(`Generate a comprehensive ${testTypeLabel.toUpperCase()} TEST PLAN for CRITICAL PROCESSES ONLY in this project.\n\n`);
    } else {
      lines.push(`Generate a comprehensive ${testTypeLabel.toUpperCase()} TEST PLAN for this project.\n\n`);
    }

    lines.push(`## Instructions\n`);
    lines.push(`1. Analyze the codebase structure\n`);
    
    // Type-specific instructions
    if (testType === 'unit') {
      lines.push(`2. Identify all functions, methods, and components that need unit testing\n`);
      lines.push(`3. Create a detailed test plan for individual units in isolation\n`);
    } else if (testType === 'integration') {
      lines.push(`2. Identify all API endpoints, services, and integrations\n`);
      lines.push(`3. Create a detailed test plan for integration points\n`);
    } else if (testType === 'e2e') {
      lines.push(`2. Identify all critical user flows and business scenarios\n`);
      lines.push(`3. Create a detailed test plan for end-to-end user journeys\n`);
    } else if (testType === 'contract') {
      lines.push(`2. Identify all API contracts between services\n`);
      lines.push(`3. Create a detailed test plan for contract verification\n`);
    } else if (testType === 'load') {
      lines.push(`2. Identify all CRITICAL processes and performance-critical endpoints\n`);
      lines.push(`3. Create a detailed test plan for load and performance testing of critical processes only\n`);
    }

    lines.push(`## Output Format\n`);
    lines.push(`**CRITICAL INSTRUCTIONS:**\n`);
    lines.push(`1. You MUST include the complete JSON array directly in your response\n`);
    lines.push(`2. Do NOT mention creating files, saving files, or file names\n`);
    lines.push(`3. Do NOT just describe the plan - you MUST include the actual JSON array\n`);
    lines.push(`4. Your response must contain a \`\`\`json code block with the complete array\n`);
    lines.push(`5. Start your response with the JSON array, not with descriptions\n\n`);
    lines.push(`Provide the test plan as a JSON array with the following structure:\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`[\n`);
    lines.push(`  {\n`);
    lines.push(`    "id": "unique-id-1",\n`);
    lines.push(`    "test_name": "Test name",\n`);
    lines.push(`    "description": "What this test will verify",\n`);
    
    if (testType === 'integration' || testType === 'e2e') {
      lines.push(`    "endpoint": "/api/endpoint/path",\n`);
      lines.push(`    "method": "GET|POST|PUT|DELETE|PATCH",\n`);
      lines.push(`    "expected_status": 200,\n`);
    }
    if (testType === 'unit') {
      lines.push(`    "component": "Component/Function name",\n`);
    }
    if (testType === 'e2e') {
      lines.push(`    "user_flow": "Description of user flow",\n`);
    }
    if (testType === 'contract') {
      lines.push(`    "contract_consumer": "Consumer service name",\n`);
      lines.push(`    "contract_provider": "Provider service name",\n`);
    }
    if (testType === 'load') {
      lines.push(`    "load_scenario": "Scenario description",\n`);
      lines.push(`    "expected_throughput": 1000,\n`);
      lines.push(`    "expected_response_time": 200,\n`);
    }
    
    lines.push(`    "test_data": { "key": "value" },\n`);
    lines.push(`    "dependencies": ["id-of-other-test"],\n`);
    lines.push(`    "priority": "high|medium|low"\n`);
    lines.push(`  }\n`);
    lines.push(`]\n`);
    lines.push(`\`\`\`\n\n`);
    lines.push(`**FINAL REMINDER: Your response MUST start with or contain the complete JSON array in a \`\`\`json code block. Example format:**\n\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`[\n`);
    lines.push(`  { "id": "...", "test_name": "...", ... },\n`);
    lines.push(`  { "id": "...", "test_name": "...", ... }\n`);
    lines.push(`]\n`);
    lines.push(`\`\`\`\n\n`);
    lines.push(`**Do NOT write descriptions before the JSON. Start directly with the \`\`\`json block or include it immediately after a brief introduction.**\n\n`);

    lines.push(`## Requirements\n`);
    
    if (testType === 'unit') {
      lines.push(`- Include tests for all individual functions, methods, and components\n`);
      lines.push(`- Focus on testing units in isolation with mocked dependencies\n`);
      lines.push(`- Cover edge cases and error handling\n`);
    } else if (testType === 'integration') {
      lines.push(`- Include tests for all major API endpoints\n`);
      lines.push(`- Include tests for database operations\n`);
      lines.push(`- Include tests for service-to-service communication\n`);
    } else if (testType === 'e2e') {
      lines.push(`- Include tests for complete user journeys\n`);
      lines.push(`- Cover critical business scenarios\n`);
      lines.push(`- Test from user perspective (browser/UI)\n`);
    } else if (testType === 'contract') {
      lines.push(`- Include tests for all API contracts\n`);
      lines.push(`- Verify request/response schemas\n`);
      lines.push(`- Test consumer-provider interactions\n`);
    } else if (testType === 'load') {
      lines.push(`- Focus ONLY on CRITICAL processes and performance-critical endpoints\n`);
      lines.push(`- Define load scenarios for critical processes (concurrent users, requests per second)\n`);
      lines.push(`- Specify expected performance metrics (throughput, response time)\n`);
      lines.push(`- Exclude non-critical processes from the test plan\n`);
    }
    
    lines.push(`- Specify dependencies between tests (e.g., create before read)\n`);
    lines.push(`- Assign priority levels (high for critical paths, medium for important, low for edge cases)\n`);
    lines.push(`- Provide clear descriptions of what each test will verify\n\n`);

    if (data.coding_session_id) {
      lines.push(`**Note**: Focus on testing the recently implemented features from the coding session.\n\n`);
    }

    return lines.join('\n');
  }

  private getTestTypeLabel(testType: TestType): string {
    switch (testType) {
      case 'unit':
        return 'Unit Test';
      case 'integration':
        return 'Integration Test';
      case 'e2e':
        return 'E2E Test';
      case 'contract':
        return 'Contract Test';
      case 'load':
        return 'Load Test';
      default:
        return 'Test';
    }
  }

  /**
   * Build prompt to execute tests based on plan (for all test types)
   */
  private async buildExecutionPrompt(plan: TestPlan): Promise<string> {
    const project = await this.projectRepo.findById(plan.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    const testTypeLabel = this.getTestTypeLabel(plan.test_type);
    
    const lines: string[] = [];
    lines.push(`# ${testTypeLabel} Test Execution\n`);
    lines.push(`**Project**: ${project.name}\n`);
    lines.push(`**Tech Stack**: ${project.tech_stack || 'Not specified'}\n`);
    lines.push(`**Test Type**: ${testTypeLabel}\n\n`);

    lines.push(`## Test Plan\n`);
    lines.push(`Execute the following ${testTypeLabel.toLowerCase()} tests in order (respecting dependencies):\n\n`);

    // Sort items by dependencies and priority
    const sortedItems = this.sortPlanItems(plan.items);

    sortedItems.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.test_name}\n`);
      lines.push(`**Description**: ${item.description}\n`);
      
      if (plan.test_type === 'unit' && item.component) {
        lines.push(`**Component/Function**: ${item.component}\n`);
      }
      if ((plan.test_type === 'integration' || plan.test_type === 'e2e') && item.endpoint) {
        lines.push(`**Endpoint**: ${item.method || 'GET'} ${item.endpoint}\n`);
      }
      if (plan.test_type === 'e2e' && item.user_flow) {
        lines.push(`**User Flow**: ${item.user_flow}\n`);
      }
      if (plan.test_type === 'contract') {
        if (item.contract_consumer) lines.push(`**Consumer**: ${item.contract_consumer}\n`);
        if (item.contract_provider) lines.push(`**Provider**: ${item.contract_provider}\n`);
      }
      if (plan.test_type === 'load') {
        if (item.load_scenario) lines.push(`**Scenario**: ${item.load_scenario}\n`);
        if (item.expected_throughput) lines.push(`**Expected Throughput**: ${item.expected_throughput} req/s\n`);
        if (item.expected_response_time) lines.push(`**Expected Response Time**: ${item.expected_response_time}ms\n`);
      }
      
      if (item.expected_status) {
        lines.push(`**Expected Status**: ${item.expected_status}\n`);
      }
      if (item.test_data) {
        lines.push(`**Test Data**: \`${JSON.stringify(item.test_data)}\`\n`);
      }
      if (item.dependencies && item.dependencies.length > 0) {
        lines.push(`**Dependencies**: ${item.dependencies.join(', ')}\n`);
      }
      lines.push(`**Priority**: ${item.priority || 'medium'}\n\n`);
    });

    lines.push(`## Instructions\n`);
    lines.push(`1. Execute each test in the order specified\n`);
    lines.push(`2. Respect dependencies (run dependent tests after their dependencies)\n`);
    
    if (plan.test_type === 'unit') {
      lines.push(`3. Test each unit in isolation with mocked dependencies\n`);
    } else if (plan.test_type === 'integration') {
      lines.push(`3. Test API endpoints and service integrations\n`);
    } else if (plan.test_type === 'e2e') {
      lines.push(`3. Test complete user flows from start to finish\n`);
    } else if (plan.test_type === 'contract') {
      lines.push(`3. Verify API contracts match expectations\n`);
    } else if (plan.test_type === 'load') {
      lines.push(`3. Execute load tests for CRITICAL processes only and measure performance metrics\n`);
      lines.push(`4. Focus on performance-critical endpoints and processes\n`);
    }
    
    lines.push(`## Output Format\n`);
    lines.push(`**CRITICAL INSTRUCTIONS:**\n`);
    lines.push(`1. You MUST include the complete JSON results directly in your response\n`);
    lines.push(`2. Do NOT mention creating files, saving files, or file names\n`);
    lines.push(`3. Do NOT just describe the results - you MUST include the actual JSON object\n`);
    lines.push(`4. Your response must contain a \`\`\`json code block with the complete results\n`);
    lines.push(`5. Start your response with the JSON results, not with descriptions\n\n`);
    lines.push(`Report results in JSON format:\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`{\n`);
    lines.push(`  "summary": {\n`);
    lines.push(`    "total": 0,\n`);
    lines.push(`    "passed": 0,\n`);
    lines.push(`    "failed": 0,\n`);
    lines.push(`    "skipped": 0\n`);
    lines.push(`  },\n`);
    lines.push(`  "tests": [\n`);
    lines.push(`    {\n`);
    lines.push(`      "name": "test name",\n`);
    lines.push(`      "type": "${plan.test_type}",\n`);
    lines.push(`      "status": "passed|failed|skipped",\n`);
    lines.push(`      "duration": 100\n`);
    lines.push(`    }\n`);
    lines.push(`  ]\n`);
    lines.push(`}\n`);
    lines.push(`\`\`\`\n\n`);
    lines.push(`**FINAL REMINDER: Your response MUST start with or contain the complete JSON object in a \`\`\`json code block. Do NOT write descriptions before the JSON. Start directly with the \`\`\`json block.**\n\n`);

    return lines.join('\n');
  }

  /**
   * Sort plan items by dependencies and priority
   */
  private sortPlanItems(items: TestPlanItem[]): TestPlanItem[] {
    const sorted: TestPlanItem[] = [];
    const visited = new Set<string>();
    const itemMap = new Map<string, TestPlanItem>();
    
    items.forEach(item => itemMap.set(item.id, item));

    const visit = (item: TestPlanItem) => {
      if (visited.has(item.id)) return;
      
      // Visit dependencies first
      if (item.dependencies) {
        item.dependencies.forEach(depId => {
          const dep = itemMap.get(depId);
          if (dep) visit(dep);
        });
      }
      
      visited.add(item.id);
      sorted.push(item);
    };

    // Sort by priority first (high -> medium -> low), then visit
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sortedByPriority = [...items].sort((a, b) => {
      const aPriority = priorityOrder[a.priority || 'medium'];
      const bPriority = priorityOrder[b.priority || 'medium'];
      return aPriority - bPriority;
    });

    sortedByPriority.forEach(item => visit(item));
    return sorted;
  }
}
