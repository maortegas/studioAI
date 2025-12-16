import apiClient from './client';
import { Roadmap, CreateRoadmapRequest, UpdateRoadmapRequest } from '@devflow-studio/shared';

export const roadmapApi = {
  generate: async (projectId: string): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/roadmap/generate', { project_id: projectId });
    return response.data;
  },

  create: async (data: CreateRoadmapRequest): Promise<Roadmap> => {
    const response = await apiClient.post('/roadmap/create', data);
    return response.data;
  },

  update: async (projectId: string, data: UpdateRoadmapRequest): Promise<Roadmap> => {
    const response = await apiClient.put(`/roadmap/update/${projectId}`, data);
    return response.data;
  },

  getByProject: async (projectId: string) => {
    const response = await apiClient.get(`/roadmap/project/${projectId}`);
    return response.data;
  },
};

