export type PRDStatus = 'draft' | 'validated' | 'approved';

export interface Persona {
  role: string;
  name?: string;
  needs: string[];
  goals: string[];
  pain_points?: string[];
  characteristics?: string[];
}

export interface PRDDocument {
  id: string;
  project_id: string;
  vision: string;
  personas: Persona[];
  status: PRDStatus;
  validated_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePRDRequest {
  project_id: string;
  vision: string;
  personas: Persona[];
}

export interface UpdatePRDRequest {
  vision?: string;
  personas?: Persona[];
  status?: PRDStatus;
}

export interface PRDValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
