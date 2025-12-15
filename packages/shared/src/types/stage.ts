export type StageName =
  | 'idea'
  | 'design'
  | 'stories'
  | 'roadmap'
  | 'implementation'
  | 'qa'
  | 'release';

export type StageStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export interface ProjectStage {
  name: StageName;
  status: StageStatus;
  completion: number; // 0-100
  checklist: StageChecklistItem[];
  next_action?: string;
}

export interface StageChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

