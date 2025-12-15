export type AIProvider = 'cursor' | 'claude';
export type AIMode = 'plan' | 'patch' | 'review';
export type AIJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AIJob {
  id: string;
  project_id: string;
  task_id?: string;
  provider: AIProvider;
  command: string;
  args: Record<string, any>;
  status: AIJobStatus;
  created_at: Date;
  started_at?: Date;
  finished_at?: Date;
}

export interface AIJobEvent {
  id: string;
  job_id: string;
  event_type: 'started' | 'progress' | 'output' | 'error' | 'completed' | 'failed';
  payload: Record<string, any>;
  created_at: Date;
}

export interface ExecuteAIJobRequest {
  task_id?: string;
  project_id: string;
  provider: AIProvider;
  mode: AIMode;
  prompt?: string;
}

