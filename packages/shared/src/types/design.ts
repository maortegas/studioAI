export interface UserFlow {
  id: string;
  project_id: string;
  flow_name: string;
  flow_diagram?: string; // Mermaid diagram or structured text
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Prototype {
  id: string;
  project_id: string;
  file_path: string;
  file_name: string;
  analysis_result?: {
    elements?: Array<{
      type: string;
      position?: { x: number; y: number };
      label?: string;
    }>;
    flows?: Array<{
      from: string;
      to: string;
      description?: string;
    }>;
    insights?: string[];
  };
  uploaded_at: Date;
}

export interface GenerateUserFlowRequest {
  project_id: string;
  prd_id?: string;
  story_ids?: string[];
  flow_name: string;
  description?: string;
}

export interface AnalyzePrototypeRequest {
  project_id: string;
  file_path: string;
  file_name: string;
}
