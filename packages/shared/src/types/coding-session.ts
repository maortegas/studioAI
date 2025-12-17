export type ProgrammerType = 'backend' | 'frontend' | 'fullstack';

export type CodingSessionStatus = 'pending' | 'generating_tests' | 'tests_generated' | 'running' | 'completed' | 'failed' | 'paused';

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

export type TestStrategy = 'tdd' | 'after' | 'none'; // TDD: tests before coding, after: unit tests after coding, none: no testing

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
