import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to suppress 404 errors for expected cases (like test plans not existing yet)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't log 404 errors to console - they're expected in some cases
    // The calling code will handle them appropriately
    if (error.response?.status === 404) {
      // Suppress console error for 404s
      // Return the error so calling code can handle it
      return Promise.reject(error);
    }
    // Log other errors normally
    return Promise.reject(error);
  }
);

export default apiClient;

