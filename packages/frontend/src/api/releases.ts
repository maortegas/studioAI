import apiClient from './client';
import { Release, CreateReleaseRequest, UpdateReleaseRequest, ReleaseSummary } from '@devflow-studio/shared';

export async function getReleasesByProject(projectId: string): Promise<Release[]> {
  const response = await apiClient.get(`/releases/project/${projectId}`);
  return response.data;
}

export async function getReleaseSummary(projectId: string): Promise<ReleaseSummary> {
  const response = await apiClient.get(`/releases/project/${projectId}/summary`);
  return response.data;
}

export async function getRelease(id: string): Promise<Release> {
  const response = await apiClient.get(`/releases/${id}`);
  return response.data;
}

export async function createRelease(data: CreateReleaseRequest): Promise<Release> {
  const response = await apiClient.post('/releases', data);
  return response.data;
}

export async function updateRelease(id: string, data: UpdateReleaseRequest): Promise<Release> {
  const response = await apiClient.put(`/releases/${id}`, data);
  return response.data;
}

export async function publishRelease(id: string): Promise<Release> {
  const response = await apiClient.post(`/releases/${id}/publish`);
  return response.data;
}

export async function deleteRelease(id: string): Promise<void> {
  await apiClient.delete(`/releases/${id}`);
}

export interface GenerateDeploymentRequest {
  release_id?: string;
  version?: string;
  database_url?: string;
  api_port?: number;
  frontend_port?: number;
  node_env?: string;
}

export interface GenerateDeploymentResponse {
  message: string;
  files: {
    docker_compose_path: string;
    readme_path: string;
    package_json_path: string;
    env_example_path: string;
    dockerfile_backend_path: string;
    dockerfile_frontend_path: string;
  };
}

export async function generateDeployment(
  projectId: string,
  environment: 'staging' | 'production',
  config?: GenerateDeploymentRequest
): Promise<GenerateDeploymentResponse> {
  const response = await apiClient.post(
    `/releases/project/${projectId}/deploy/${environment}`,
    config || {}
  );
  return response.data;
}
