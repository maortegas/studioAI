export type EpicStatus = 'planned' | 'in_progress' | 'completed';

export interface Epic {
  id: string;
  project_id: string;
  rfc_id?: string;
  title: string;
  description?: string;
  story_points?: number;
  status: EpicStatus;
  order_index?: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEpicRequest {
  project_id: string;
  rfc_id?: string;
  title: string;
  description?: string;
  order_index?: number;
}

export interface UpdateEpicRequest {
  title?: string;
  description?: string;
  story_points?: number;
  status?: EpicStatus;
  order_index?: number;
}

export interface BreakdownRequest {
  project_id: string;
  rfc_id: string;
  epic_ids?: string[]; // Optional: specific epics to breakdown
  options?: {
    max_days_per_task?: number; // Default: 3
    estimate_story_points?: boolean;
  };
}

export interface BreakdownResponse {
  epics: Epic[];
  tasks: Array<{
    title: string;
    description?: string;
    epic_id: string;
    estimated_days: number;
    story_points?: number;
    breakdown_order: number;
  }>;
  summary: {
    total_epics: number;
    total_tasks: number;
    total_story_points: number;
    average_days_per_task: number;
  };
}
