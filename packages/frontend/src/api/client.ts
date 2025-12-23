import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to suppress 404 errors for expected cases (like test plans, PRDs not existing yet)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't log 404 errors to console - they're expected in some cases
    // The calling code will handle them appropriately
    if (error.response?.status === 404) {
      // Suppress console error for 404s by creating a silent error
      // Return the error so calling code can handle it, but don't log to console
      const silentError = new Error(error.message);
      (silentError as any).response = error.response;
      (silentError as any).config = error.config;
      (silentError as any).isAxiosError = true;
      return Promise.reject(silentError);
    }
    // Log other errors normally
    return Promise.reject(error);
  }
);

export default apiClient;

