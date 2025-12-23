import apiClient from './client';
import { UserFlow, Prototype, GenerateUserFlowRequest } from '@devflow-studio/shared';

export const designApi = {
  // User Flows
  generateUserFlow: async (data: GenerateUserFlowRequest): Promise<{ job_id: string; user_flow_id: string }> => {
    const response = await apiClient.post('/design/user-flows/generate', data);
    return response.data;
  },

  getUserFlowsByProject: async (projectId: string): Promise<UserFlow[]> => {
    const response = await apiClient.get(`/design/user-flows/project/${projectId}`);
    return response.data;
  },

  getUserFlowById: async (id: string): Promise<UserFlow> => {
    const response = await apiClient.get(`/design/user-flows/${id}`);
    return response.data;
  },

  // Prototypes
  analyzePrototype: async (projectId: string, file: File): Promise<{ job_id: string; prototype_id: string }> => {
    const formData = new FormData();
    formData.append('project_id', projectId);
    formData.append('prototype', file);
    
    const response = await apiClient.post('/design/prototypes/analyze', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getPrototypesByProject: async (projectId: string): Promise<Prototype[]> => {
    const response = await apiClient.get(`/design/prototypes/project/${projectId}`);
    return response.data;
  },

  getPrototypeById: async (id: string): Promise<Prototype> => {
    const response = await apiClient.get(`/design/prototypes/${id}`);
    return response.data;
  },
};
