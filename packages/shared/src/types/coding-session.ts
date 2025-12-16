export type ProgrammerType = 'backend' | 'frontend' | 'fullstack';

export type CodingSessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export interface CodingSession {
  id: string;
  project_id: string;
  story_id: string; // Task ID of the user story
  programmer_type: ProgrammerType;
  ai_job_id?: string;
  status: CodingSessionStatus;
  progress: number; // 0-100
  current_file?: string;
  output?: string;
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
}

export interface CodingSessionEvent {
  session_id: string;
  event_type: 'progress' | 'file_change' | 'output' | 'error' | 'completed';
  payload: {
    progress?: number;
    current_file?: string;
    output?: string;
    error?: string;
    message?: string;
  };
  timestamp: Date;
}

export interface StartImplementationRequest {
  project_id: string;
  story_ids: string[]; // Array of story IDs to implement
  auto_assign?: boolean; // Auto-assign backend/frontend based on story context
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
