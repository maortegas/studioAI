import apiClient from './client';

export interface ReviewStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  current_step?: string;
  progress?: number;
  build_status?: 'pending' | 'running' | 'success' | 'failed';
  test_status?: 'pending' | 'running' | 'success' | 'failed';
  errors?: string[];
  warnings?: string[];
  iterations?: number;
  output?: string;
}

export async function startProjectReview(projectId: string): Promise<{ review_job_id: string; message: string }> {
  const response = await apiClient.post(`/review/project/${projectId}/start`);
  return response.data;
}

export async function stopReview(projectId: string): Promise<void> {
  await apiClient.post(`/review/project/${projectId}/stop`);
}

export async function getReviewStatus(projectId: string): Promise<ReviewStatus> {
  const response = await apiClient.get(`/review/project/${projectId}/status`);
  return response.data;
}

export async function fixSelectedErrors(projectId: string, errorIds: string[]): Promise<{ fix_job_id: string; message: string }> {
  const response = await apiClient.post(`/review/project/${projectId}/fix-errors`, { error_ids: errorIds });
  return response.data;
}

export async function getFileContent(projectId: string, filePath: string): Promise<{ content: string }> {
  const response = await apiClient.get(`/review/project/${projectId}/file`, { params: { path: filePath } });
  return response.data;
}

export async function openFileInEditor(projectId: string, filePath: string, lineNumber?: number): Promise<void> {
  await apiClient.post(`/review/project/${projectId}/file/open`, { path: filePath, line: lineNumber });
}

export async function runSingleError(projectId: string, errorId: string, category: string): Promise<{ job_id: string; message: string }> {
  const response = await apiClient.post(`/review/project/${projectId}/run-error`, { error_id: errorId, category });
  return response.data;
}

export async function saveFileContent(projectId: string, filePath: string, content: string): Promise<void> {
  await apiClient.post(`/review/project/${projectId}/file/save`, { path: filePath, content });
}

