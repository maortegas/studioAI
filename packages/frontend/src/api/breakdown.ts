import apiClient from './client';
import { Epic, BreakdownRequest, BreakdownResponse } from '@devflow-studio/shared';

export const breakdownApi = {
  generate: async (data: BreakdownRequest): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/breakdown/generate', data);
    return response.data;
  },

  getEpicsByProject: async (projectId: string): Promise<Epic[]> => {
    const response = await apiClient.get(`/breakdown/epics/project/${projectId}`);
    return response.data;
  },

  getEpicsByRFC: async (rfcId: string): Promise<Epic[]> => {
    const response = await apiClient.get(`/breakdown/epics/rfc/${rfcId}`);
    return response.data;
  },
};
