import { Task } from './task';
import { Artifact } from './artifact';

export interface RoadmapMilestone {
  id?: string;
  title: string;
  description?: string;
  targetDate?: string; // ISO date string
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: number;
  taskIds?: string[]; // IDs of tasks/stories included in this milestone
  dependencies?: string[]; // IDs of other milestones this depends on
}

export interface Roadmap {
  id?: string;
  project_id: string;
  title: string;
  description?: string;
  milestones: RoadmapMilestone[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateRoadmapRequest {
  project_id: string;
  title: string;
  description?: string;
  milestones: Omit<RoadmapMilestone, 'id'>[];
}

export interface UpdateRoadmapRequest {
  title?: string;
  description?: string;
  milestones?: RoadmapMilestone[];
}

export interface RoadmapResponse {
  roadmap: Artifact | null;
  milestones: Task[];
}

