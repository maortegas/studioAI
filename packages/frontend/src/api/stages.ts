import apiClient from './client';
import { ProjectStage } from '@devflow-studio/shared';

export const stagesApi = {
  getByProject: async (projectId: string): Promise<ProjectStage[]> => {
    const response = await apiClient.get(`/stages/project/${projectId}`);
    return response.data;
  },
};

