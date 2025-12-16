export type QASessionStatus = 'pending' | 'running' | 'completed' | 'failed';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface TestResult {
  id: string;
  session_id: string;
  test_name: string;
  test_type: 'unit' | 'integration' | 'e2e' | 'performance' | 'security';
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
}
