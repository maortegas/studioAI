export type QASessionStatus = 'pending' | 'running' | 'completed' | 'failed';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'error';

export type TestType = 'unit' | 'integration' | 'e2e' | 'contract' | 'load';

export interface TestResult {
  id: string;
  session_id: string;
  test_name: string;
  test_type: TestType;
  status: TestStatus;
  duration?: number; // milliseconds
  error_message?: string;
  stack_trace?: string;
  output?: string;
  created_at: Date;
}

export interface QASession {
  id: string;
  project_id: string;
  coding_session_id?: string; // Associated coding session
  test_type?: TestType; // Type of tests in this session (unit, integration, e2e, contract, load)
  status: QASessionStatus;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  skipped_tests: number;
  coverage_percentage?: number;
  report_path?: string;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface QAReport {
  session_id: string;
  project_id: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
  };
  test_results: TestResult[];
  recommendations?: string[];
  created_at: Date;
}

export interface CreateQASessionRequest {
  project_id: string;
  coding_session_id?: string;
  test_type?: TestType; // Type of tests to generate/run
  auto_run?: boolean;
}

export interface QADashboard {
  project_id: string;
  total_sessions: number;
  passed_sessions: number;
  failed_sessions: number;
  average_coverage?: number;
  last_session?: QASession;
  recent_sessions: QASession[];
  // Metrics segmented by test type
  by_type: {
    [key in TestType]?: {
      total_sessions: number;
      passed_sessions: number;
      failed_sessions: number;
      average_coverage?: number;
      pass_rate: number;
    };
  };
}

// Test Plan (for all test types)
export interface TestPlanItem {
  id: string;
  test_name: string;
  description: string;
  endpoint?: string; // API endpoint to test (for integration/e2e)
  method?: string; // HTTP method (GET, POST, PUT, DELETE, etc.)
  expected_status?: number; // Expected HTTP status code
  test_data?: any; // Test data/payload
  dependencies?: string[]; // IDs of other test items this depends on
  priority?: 'high' | 'medium' | 'low';
  // Additional fields for different test types
  component?: string; // For unit tests (component/function name)
  user_flow?: string; // For e2e tests (user flow description)
  contract_consumer?: string; // For contract tests
  contract_provider?: string; // For contract tests
  load_scenario?: string; // For load tests (scenario description)
  expected_throughput?: number; // For load tests
  expected_response_time?: number; // For load tests (ms)
}

export interface TestPlan {
  id: string;
  project_id: string;
  qa_session_id?: string;
  coding_session_id?: string;
  test_type: TestType; // Type of tests in this plan
  items: TestPlanItem[];
  status: 'draft' | 'approved' | 'executing' | 'completed';
  created_at: Date;
  updated_at: Date;
}

export interface CreateTestPlanRequest {
  project_id: string;
  qa_session_id?: string;
  coding_session_id?: string;
  test_type: TestType;
}

export interface UpdateTestPlanRequest {
  items?: TestPlanItem[];
  status?: 'draft' | 'approved' | 'executing' | 'completed';
}

// Legacy aliases for backward compatibility
export type IntegrationTestPlanItem = TestPlanItem;
export type IntegrationTestPlan = TestPlan;
export type CreateIntegrationTestPlanRequest = CreateTestPlanRequest;
export type UpdateIntegrationTestPlanRequest = UpdateTestPlanRequest;
