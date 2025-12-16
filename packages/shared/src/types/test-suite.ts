export type TestType = 'unit' | 'integration' | 'e2e' | 'performance' | 'security';
export type TestSuiteStatus = 'pending' | 'generating' | 'ready' | 'running' | 'passed' | 'failed' | 'skipped';
export type TestExecutionType = 'auto' | 'manual' | 'ci';
export type TestExecutionStatus = 'running' | 'passed' | 'failed' | 'skipped' | 'error';

export interface TestSuite {
  id: string;
  project_id: string;
  coding_session_id?: string;
  story_id?: string;
  name: string;
  description?: string;
  test_type: TestType;
  status: TestSuiteStatus;
  file_path?: string;
  test_code?: string;
  generated_at?: Date;
  executed_at?: Date;
  execution_result?: any;
  created_at: Date;
  updated_at: Date;
}

export interface TestExecution {
  id: string;
  test_suite_id: string;
  execution_type: TestExecutionType;
  status: TestExecutionStatus;
  started_at: Date;
  completed_at?: Date;
  duration?: number;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  skipped_tests: number;
  output?: string;
  error_message?: string;
  created_at: Date;
}

export interface CreateTestSuiteRequest {
  project_id: string;
  coding_session_id?: string;
  story_id?: string;
  name: string;
  description?: string;
  test_type: TestType;
}

export interface UpdateTestSuiteRequest {
  name?: string;
  description?: string;
  test_code?: string;
  status?: TestSuiteStatus;
}

export interface TestSuiteWithExecutions extends TestSuite {
  executions: TestExecution[];
  last_execution?: TestExecution;
}
