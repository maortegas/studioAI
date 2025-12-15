export interface Run {
  id: string;
  task_id?: string;
  provider: string;
  model: string;
  input_hash: string;
  output_hash: string;
  cost?: number;
  created_at: Date;
  updated_at: Date;
}

