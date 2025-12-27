import apiClient from './client';
import { RFCDocument, GenerateRFCRequest } from '@devflow-studio/shared';

export const rfcApi = {
  generate: async (data: GenerateRFCRequest): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/rfc/generate', data);
    return response.data;
  },

  getById: async (id: string): Promise<RFCDocument> => {
    const response = await apiClient.get(`/rfc/${id}`);
    return response.data;
  },

  getByProject: async (projectId: string): Promise<RFCDocument[]> => {
    const response = await apiClient.get(`/rfc/project/${projectId}`);
    return response.data;
  },

  getAPIContracts: async (rfcId: string): Promise<any[]> => {
    const response = await apiClient.get(`/rfc/${rfcId}/api-contracts`);
    return response.data;
  },

  getDatabaseSchemas: async (rfcId: string): Promise<any[]> => {
    const response = await apiClient.get(`/rfc/${rfcId}/database-schemas`);
    return response.data;
  },

  approve: async (rfcId: string): Promise<RFCDocument> => {
    const response = await apiClient.post(`/rfc/${rfcId}/approve`);
    return response.data.rfc;
  },

  updateStatus: async (rfcId: string, status: 'draft' | 'review' | 'approved' | 'rejected'): Promise<RFCDocument> => {
    const response = await apiClient.patch(`/rfc/${rfcId}/status`, { status });
    return response.data;
  },
};
