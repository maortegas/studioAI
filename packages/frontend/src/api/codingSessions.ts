import apiClient from './client';
import {
  CodingSession,
  CreateCodingSessionRequest,
  StartImplementationRequest,
  ImplementationDashboard,
} from '@devflow-studio/shared';

export const codingSessionsApi = {
  create: async (data: CreateCodingSessionRequest): Promise<CodingSession> => {
    const response = await apiClient.post('/coding-sessions/create', data);
    return response.data;
  },

  startImplementation: async (data: StartImplementationRequest) => {
    const response = await apiClient.post('/coding-sessions/start-implementation', data);
    return response.data;
  },

  getDashboard: async (projectId: string): Promise<ImplementationDashboard> => {
    const response = await apiClient.get(`/coding-sessions/dashboard/${projectId}`);
    return response.data;
  },

  getSession: async (sessionId: string): Promise<CodingSession> => {
    const response = await apiClient.get(`/coding-sessions/${sessionId}`);
    return response.data;
  },

  getProjectSessions: async (projectId: string): Promise<CodingSession[]> => {
    const response = await apiClient.get(`/coding-sessions/project/${projectId}`);
    return response.data;
  },

  pauseSession: async (sessionId: string) => {
    const response = await apiClient.post(`/coding-sessions/${sessionId}/pause`);
    return response.data;
  },

  resumeSession: async (sessionId: string) => {
    const response = await apiClient.post(`/coding-sessions/${sessionId}/resume`);
    return response.data;
  },

  deleteSession: async (sessionId: string) => {
    const response = await apiClient.delete(`/coding-sessions/${sessionId}`);
    return response.data;
  },

  retrySession: async (sessionId: string): Promise<{ session: CodingSession; message: string }> => {
    const response = await apiClient.post(`/coding-sessions/${sessionId}/retry`);
    return response.data;
  },

  startReview: async (sessionId: string): Promise<{ review_job_id: string; message: string }> => {
    const response = await apiClient.post(`/coding-sessions/${sessionId}/review`);
    return response.data;
  },

  // Connect to SSE stream for real-time updates
  connectStream: (sessionId: string, onEvent: (event: any) => void, onError?: (error: any) => void) => {
    const eventSource = new EventSource(`${apiClient.defaults.baseURL}/coding-sessions/stream/${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(data);
      } catch (error) {
        console.error('Error parsing SSE event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      if (onError) onError(error);
    };

    return eventSource; // Return so caller can close it
  },
};
