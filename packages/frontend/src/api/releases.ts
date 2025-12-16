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
