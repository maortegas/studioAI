import apiClient from './client';
import { PRDDocument, CreatePRDRequest, UpdatePRDRequest } from '@devflow-studio/shared';

export const prdApi = {
  getByProject: async (projectId: string): Promise<PRDDocument | null> => {
    try {
      // Use validateStatus to prevent axios from throwing on 404
      // This prevents the error from appearing in console
      const response = await apiClient.get(`/prd/project/${projectId}`, {
        validateStatus: function (status) {
          // Don't throw error for 404, return it as valid response
          return status === 200 || status === 404;
        },
      });
      
      // If 404, return null (no PRD exists yet, which is fine)
      if (response.status === 404 || !response.data) {
        return null;
      }
      
      return response.data;
    } catch (error: any) {
      // Fallback: if somehow error was thrown, check if it's 404
      if (error.response?.status === 404) {
        return null;
      }
      // Re-throw other errors (but these should be rare with validateStatus)
      console.error('Error fetching PRD:', error);
      throw error;
    }
  },

  getById: async (id: string): Promise<PRDDocument> => {
    const response = await apiClient.get(`/prd/${id}`);
    return response.data;
  },

  create: async (data: CreatePRDRequest): Promise<PRDDocument> => {
    const response = await apiClient.post('/prd', data);
    return response.data;
  },

  update: async (id: string, data: UpdatePRDRequest): Promise<PRDDocument> => {
    const response = await apiClient.put(`/prd/${id}`, data);
    return response.data;
  },

  validate: async (id: string): Promise<PRDDocument> => {
    const response = await apiClient.post(`/prd/${id}/validate`);
    return response.data;
  },
};
