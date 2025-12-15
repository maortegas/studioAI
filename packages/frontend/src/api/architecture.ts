import apiClient from './client';

export const architectureApi = {
  generate: async (projectId: string, provider: string = 'cursor'): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/architecture/generate', { 
      project_id: projectId,
      provider 
    });
    return response.data;
  },

  getByProject: async (projectId: string) => {
    const response = await apiClient.get(`/architecture/project/${projectId}`);
    return response.data;
  },

  upload: async (projectId: string, file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', projectId);
    formData.append('type', 'architecture');
    formData.append('path', `artifacts/ARCHITECTURE.${file.name.split('.').pop()}`);

    const response = await apiClient.post('/artifacts', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};

