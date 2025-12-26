export type ProgrammerType = 'backend' | 'frontend' | 'fullstack';

export type CodingSessionStatus = 
  | 'pending' 
  | 'generating_tests' 
  | 'tests_generated' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'paused'
  | 'reviewing'
  | 'tdd_green'    // GREEN phase: Implementing code to pass tests (batch)
  | 'tdd_refactor' // REFACTOR phase: Strategic refactoring at key points
  | 'tdd_ready'    // Context files created, ready for implementation
  | 'tdd_implementing'; // All-at-once implementation in progress

export type TestStrategy = 'tdd' | 'after' | 'none'; // TDD: tests before coding, after: unit tests after coding, none: no testing

// TDD Cycle state interface (optimized for batch processing)
export interface TDDCycle {
  test_index: number;           // Current test batch starting index (0-based)
  phase: 'green' | 'refactor';  // Current phase (no RED - tests obviously fail before implementation)
  batch_size: number;           // Number of tests to implement per batch (default: 3)
  current_batch_tests: string[];// Test names in current batch
  tests_passed: number;         // Number of tests passing
  total_tests: number;          // Total tests to implement
  all_tests: Array<{            // All tests for this session
    name: string;
    code: string;
    status: 'pending' | 'green' | 'refactored';
    attempts: number;
  }>;
  refactor_count: number;       // Number of strategic refactors done
  stuck_count: number;          // Number of times stuck in GREEN phase
  context_bundle?: string;      // Cached prompt bundle (loaded once, reused)
}

export interface CodingSession {
  id: string;
  project_id: string;
  story_id: string; // Task ID of the user story
  programmer_type: ProgrammerType;
  ai_job_id?: string;
  test_generation_job_id?: string; // AI job for test generation
  implementation_job_id?: string; // AI job for implementation
  status: CodingSessionStatus;
  progress: number; // 0-100
  test_progress?: number; // 0-50 for test generation phase
  implementation_progress?: number; // 0-50 for implementation phase
  current_file?: string;
  output?: string;
  tests_output?: string; // Generated tests content
  error?: string;
  tdd_cycle?: TDDCycle; // TDD cycle state for strict TDD mode
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCodingSessionRequest {
  project_id: string;
  story_id: string;
  programmer_type: ProgrammerType;
  provider?: 'cursor' | 'claude';
  test_strategy?: TestStrategy; // 'tdd' for test-driven development (tests before), 'after' for unit tests after coding
}

export interface CodingSessionEvent {
  session_id: string;
  event_type: 'progress' | 'file_change' | 'output' | 'error' | 'completed' | 'tests_generated' | 'implementation_started';
  payload: {
    progress?: number;
    test_progress?: number;
    implementation_progress?: number;
    current_file?: string;
    output?: string;
    tests_output?: string;
    error?: string;
    message?: string;
  };
  timestamp: Date;
}

export interface StartImplementationRequest {
  project_id: string;
  story_ids: string[]; // Array of story IDs to implement
  auto_assign?: boolean; // Auto-assign backend/frontend based on story context
  test_strategy?: TestStrategy; // 'tdd' for test-driven development (tests before), 'after' for unit tests after coding
}

export interface ImplementationDashboard {
  project_id: string;
  sessions: CodingSession[];
  total_stories: number;
  completed_stories: number;
  in_progress: number;
  pending: number;
  failed: number;
}
