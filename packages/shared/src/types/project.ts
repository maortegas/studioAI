export interface Project {
  id: string;
  name: string;
  base_path: string;
  tech_stack?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectRequest {
  name: string;
  base_path: string;
  tech_stack?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  tech_stack?: string;
}

