import apiClient from './client';
import { AIJob, ExecuteAIJobRequest } from '@devflow-studio/shared';

export const aiJobsApi = {
  execute: async (request: ExecuteAIJobRequest): Promise<AIJob> => {
    const response = await apiClient.post('/ai-jobs/execute', request);
    return response.data;
  },

  getByProject: async (projectId: string): Promise<AIJob[]> => {
    const response = await apiClient.get(`/ai-jobs/project/${projectId}`);
    return response.data;
  },

  getById: async (id: string): Promise<AIJob> => {
    const response = await apiClient.get(`/ai-jobs/${id}`);
    return response.data;
  },

  getResult: async (id: string): Promise<{ output: string }> => {
    const response = await apiClient.get(`/ai-jobs/${id}/result`);
    return response.data;
  },
};

