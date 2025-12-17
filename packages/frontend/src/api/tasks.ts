import apiClient from './client';
import { Task, CreateTaskRequest, UpdateTaskRequest, TaskType } from '@devflow-studio/shared';

export const tasksApi = {
  getByProject: async (projectId: string): Promise<Task[]> => {
    const response = await apiClient.get(`/tasks/project/${projectId}`);
    return response.data;
  },

  getByProjectAndType: async (projectId: string, type: TaskType): Promise<Task[]> => {
    const response = await apiClient.get(`/tasks/project/${projectId}/type/${type}`);
    return response.data;
  },

  getById: async (id: string): Promise<Task> => {
    const response = await apiClient.get(`/tasks/${id}`);
    return response.data;
  },

  create: async (data: CreateTaskRequest): Promise<Task> => {
    const response = await apiClient.post('/tasks', data);
    return response.data;
  },

  update: async (id: string, data: UpdateTaskRequest): Promise<Task> => {
    const response = await apiClient.put(`/tasks/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/tasks/${id}`);
  },

  generateStories: async (projectId: string, count?: number): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/tasks/stories/generate', {
      project_id: projectId,
      count,
    });
    return response.data;
  },

  improveStory: async (projectId: string, idea: string): Promise<{ job_id: string; message: string }> => {
    const response = await apiClient.post('/tasks/stories/improve', {
      project_id: projectId,
      idea,
    });
    return response.data;
  },
};

