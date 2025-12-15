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

