import apiClient from './client';

export const roadmapApi = {
  generate: async (projectId: string): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/roadmap/generate', { project_id: projectId });
    return response.data;
  },

  getByProject: async (projectId: string) => {
    const response = await apiClient.get(`/roadmap/project/${projectId}`);
    return response.data;
  },
};

