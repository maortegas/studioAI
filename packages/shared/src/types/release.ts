export type ReleaseStatus = 'draft' | 'ready' | 'published' | 'archived';

export interface Release {
  id: string;
  project_id: string;
  version: string;
  status: ReleaseStatus;
  title?: string;
  description?: string;
  changelog?: string;
  release_notes?: string;
  git_tag?: string;
  release_date?: Date;
  created_by?: string;
  artifacts?: string[]; // Array of artifact IDs or paths
  metadata?: {
    build_info?: any;
    dependencies?: any;
    test_results?: any;
    qa_summary?: any;
    [key: string]: any;
  };
  created_at: Date;
  updated_at: Date;
}

export interface CreateReleaseRequest {
  project_id: string;
  version: string;
  title?: string;
  description?: string;
  changelog?: string;
  release_notes?: string;
  git_tag?: string;
  release_date?: Date;
  artifacts?: string[];
  metadata?: any;
}

export interface UpdateReleaseRequest {
  version?: string;
  status?: ReleaseStatus;
  title?: string;
  description?: string;
  changelog?: string;
  release_notes?: string;
  git_tag?: string;
  release_date?: Date;
  artifacts?: string[];
  metadata?: any;
}

export interface ReleaseSummary {
  total_releases: number;
  published_releases: number;
  latest_version?: string;
  latest_release_date?: Date;
}
