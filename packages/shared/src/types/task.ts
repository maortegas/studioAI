export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type TaskType = 'story' | 'milestone' | 'task' | 'epic';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  type: TaskType;
  priority: number;
  created_at: Date;
  updated_at: Date;
  // Additional fields for user stories (stored in description or metadata)
  acceptance_criteria?: string[];
  estimated_effort?: 'Low' | 'Medium' | 'High';
  // Fields for breakdown and estimation
  epic_id?: string;
  estimated_days?: number;
  breakdown_order?: number;
  story_points?: number;
  generated_from_prd?: boolean;
}

export interface CreateTaskRequest {
  project_id: string;
  title: string;
  description?: string;
  type: TaskType;
  priority?: number;
  status?: TaskStatus;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
}

