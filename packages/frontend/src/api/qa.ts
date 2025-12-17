import apiClient from './client';
import { QASession, CreateQASessionRequest, QADashboard, QAReport, TestType } from '@devflow-studio/shared';

export const qaApi = {
  create: async (data: CreateQASessionRequest): Promise<QASession> => {
    const response = await apiClient.post('/qa/create', data);
    return response.data;
  },

  createSession: async (data: CreateQASessionRequest): Promise<QASession> => {
    const response = await apiClient.post('/qa/create', data);
    return response.data;
  },

  getDashboard: async (projectId: string): Promise<QADashboard> => {
    const response = await apiClient.get(`/qa/dashboard/${projectId}`);
    return response.data;
  },

  getSession: async (sessionId: string): Promise<QAReport> => {
    const response = await apiClient.get(`/qa/session/${sessionId}`);
    return response.data;
  },

  getProjectSessions: async (projectId: string): Promise<QASession[]> => {
    const response = await apiClient.get(`/qa/project/${projectId}`);
    return response.data;
  },

  generateTests: async (projectId: string, codingSessionId?: string, testType?: TestType) => {
    const response = await apiClient.post('/qa/generate-tests', {
      project_id: projectId,
      coding_session_id: codingSessionId,
      test_type: testType,
    });
    return response.data;
  },

  generateTestsByType: async (projectId: string, testType: TestType, codingSessionId?: string) => {
    const response = await apiClient.post(`/qa/generate-tests/${testType}`, {
      project_id: projectId,
      coding_session_id: codingSessionId,
    });
    return response.data;
  },

  runQA: async (sessionId: string) => {
    const response = await apiClient.post(`/qa/run/${sessionId}`);
    return response.data;
  },

  getTestFiles: async (sessionId: string) => {
    const response = await apiClient.get(`/qa/session/${sessionId}/tests`);
    return response.data;
  },

  getTestFileContent: async (sessionId: string, fileName: string) => {
    const response = await apiClient.get(`/qa/session/${sessionId}/test/${encodeURIComponent(fileName)}`);
    return response.data;
  },

  updateTestFile: async (sessionId: string, fileName: string, content: string) => {
    const response = await apiClient.put(`/qa/session/${sessionId}/test/${encodeURIComponent(fileName)}`, {
      content,
    });
    return response.data;
  },

  deleteTestFile: async (sessionId: string, fileName: string) => {
    const response = await apiClient.delete(`/qa/session/${sessionId}/test/${encodeURIComponent(fileName)}`);
    return response.data;
  },
};
