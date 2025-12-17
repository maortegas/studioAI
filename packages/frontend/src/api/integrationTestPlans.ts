import apiClient from './client';
import { 
  TestPlan, 
  CreateTestPlanRequest,
  UpdateTestPlanRequest 
} from '@devflow-studio/shared';

export const integrationTestPlansApi = {
  generatePlan: async (data: CreateTestPlanRequest): Promise<{ plan: TestPlan; message: string }> => {
    const response = await apiClient.post('/integration-test-plans/generate', data);
    return response.data;
  },

  getPlan: async (planId: string): Promise<TestPlan> => {
    const response = await apiClient.get(`/integration-test-plans/${planId}`);
    return response.data;
  },

  getPlanByQASession: async (qaSessionId: string): Promise<TestPlan | null> => {
    try {
      const response = await apiClient.get(`/integration-test-plans/qa-session/${qaSessionId}`);
      return response.data;
    } catch (error: any) {
      // Return null for 404 (plan doesn't exist yet) - this is expected during generation
      if (error.response?.status === 404) {
        // Suppress console error for expected 404s
        return null;
      }
      // Re-throw other errors
      throw error;
    }
  },

  getPlanByCodingSession: async (codingSessionId: string): Promise<TestPlan> => {
    const response = await apiClient.get(`/integration-test-plans/coding-session/${codingSessionId}`);
    return response.data;
  },

  updatePlan: async (planId: string, data: UpdateTestPlanRequest): Promise<{ plan: TestPlan; message: string }> => {
    const response = await apiClient.put(`/integration-test-plans/${planId}`, data);
    return response.data;
  },

  deletePlan: async (planId: string): Promise<{ message: string }> => {
    const response = await apiClient.delete(`/integration-test-plans/${planId}`);
    return response.data;
  },

  executePlan: async (planId: string): Promise<{ qa_session_id: string; message: string }> => {
    const response = await apiClient.post(`/integration-test-plans/${planId}/execute`);
    return response.data;
  },
};
