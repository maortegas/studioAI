import apiClient from './client';
import { GenerateStoriesRequest, GenerateStoriesResponse } from '@devflow-studio/shared';

export const userStoriesApi = {
  generate: async (data: GenerateStoriesRequest): Promise<GenerateStoriesResponse> => {
    const response = await apiClient.post('/user-stories/generate', data);
    return response.data;
  },

  import: async (data: any): Promise<any> => {
    const response = await apiClient.post('/user-stories/import', data);
    return response.data;
  },
};
