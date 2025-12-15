export type ArtifactType =
  | 'prd'
  | 'architecture'
  | 'adr'
  | 'roadmap'
  | 'context_pack'
  | 'patch'
  | 'other';

export interface Artifact {
  id: string;
  project_id: string;
  type: ArtifactType;
  path: string;
  content: Record<string, any>;
  created_at: Date;
}

export interface CreateArtifactRequest {
  project_id: string;
  type: ArtifactType;
  path: string;
  content: Record<string, any>;
}

