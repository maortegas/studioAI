import apiClient from './client';
import { Artifact, CreateArtifactRequest } from '@devflow-studio/shared';

export const artifactsApi = {
  getByProject: async (projectId: string): Promise<Artifact[]> => {
    const response = await apiClient.get(`/artifacts/project/${projectId}`);
    return response.data;
  },

  getById: async (id: string): Promise<Artifact> => {
    const response = await apiClient.get(`/artifacts/${id}`);
    return response.data;
  },

  getContent: async (id: string): Promise<{ content: string }> => {
    const response = await apiClient.get(`/artifacts/${id}/content`);
    return response.data;
  },

  savePRD: async (projectId: string, content: string): Promise<Artifact> => {
    const response = await apiClient.post('/artifacts/prd', { project_id: projectId, content });
    return response.data;
  },

  saveArchitecture: async (projectId: string, content: string): Promise<Artifact> => {
    const response = await apiClient.post('/artifacts/architecture', { 
      project_id: projectId, 
      content 
    });
    return response.data;
  },

  generateArchitecture: async (projectId: string): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/artifacts/architecture/generate', { 
      project_id: projectId 
    });
    return response.data;
  },

  upload: async (data: CreateArtifactRequest, file?: File): Promise<Artifact> => {
    const formData = new FormData();
    formData.append('project_id', data.project_id);
    formData.append('type', data.type);
    formData.append('path', data.path);
    formData.append('content', JSON.stringify(data.content));
    if (file) {
      formData.append('file', file);
    }

    const response = await apiClient.post('/artifacts', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // ADR methods
  getADRs: async (projectId: string): Promise<Artifact[]> => {
    const response = await apiClient.get(`/artifacts/project/${projectId}/adr`);
    return response.data;
  },

  saveADR: async (projectId: string, content: string, adrNumber?: number): Promise<Artifact> => {
    const response = await apiClient.post('/artifacts/adr', {
      project_id: projectId,
      content,
      adr_number: adrNumber,
    });
    return response.data;
  },

  generateADR: async (projectId: string, decisionContext?: string): Promise<{ job_id: string; adr_number: number; message: string }> => {
    const response = await apiClient.post('/artifacts/adr/generate', {
      project_id: projectId,
      decision_context: decisionContext,
    });
    return response.data;
  },

  deleteADR: async (adrId: string): Promise<void> => {
    await apiClient.delete(`/artifacts/adr/${adrId}`);
  },
};
