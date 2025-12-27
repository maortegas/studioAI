export interface AcceptanceCriterion {
  criterion: string;
  type: 'functional' | 'technical';
  priority?: 'high' | 'medium' | 'low';
}

export interface UserStory {
  id: string;
  project_id: string;
  title: string;
  description: string; // "Yo como [usuario], quiero [acción], para [beneficio]"
  user_role: string; // Extracted from description
  action: string; // Extracted from description
  benefit: string; // Extracted from description
  related_feature?: string; // Feature ID or Title from PRD for traceability
  acceptance_criteria: AcceptanceCriterion[];
  story_points?: number;
  generated_from_prd: boolean;
  epic_id?: string;
  estimated_days?: number; // Max 2-3 days
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface GenerateStoriesRequest {
  project_id: string;
  prd_id: string;
  options?: {
    include_all_personas?: boolean;
    min_stories_per_persona?: number;
  };
}

export interface GenerateStoriesResponse {
  stories: UserStory[];
  summary: {
    total_generated: number;
    by_persona: Record<string, number>;
  };
  job_id?: string; // AI job ID for polling
}

export interface ImportStoriesRequest {
  project_id: string;
  format: 'json' | 'markdown';
  content: string;
}
