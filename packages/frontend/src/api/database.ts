import apiClient from './client';

export interface DatabaseStatus {
  hasPrisma: boolean;
  status: 'not_configured' | 'not_initialized' | 'initialized' | 'unknown';
  message?: string;
}

export interface DockerStatus {
  status: 'not_configured' | 'stopped' | 'running';
  containerName?: string;
  databaseName?: string;
}

export interface CreateDatabaseRequest {
  command?: 'migrate' | 'push';
}

export interface CreateDatabaseResponse {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
}

export const databaseApi = {
  /**
   * Verifica el estado de la base de datos
   */
  getStatus: async (projectId: string): Promise<DatabaseStatus> => {
    const response = await apiClient.get(`/projects/${projectId}/database/status`);
    return response.data;
  },

  /**
   * Verifica el estado de Docker
   */
  getDockerStatus: async (projectId: string): Promise<DockerStatus> => {
    const response = await apiClient.get(`/projects/${projectId}/database/docker-status`);
    return response.data;
  },

  /**
   * Genera la infraestructura de base de datos (docker-compose.yml, .env)
   */
  generateInfrastructure: async (projectId: string): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post(`/projects/${projectId}/database/generate-infrastructure`);
    return response.data;
  },

  /**
   * Instala e inicializa Prisma en el proyecto
   */
  setupPrisma: async (projectId: string): Promise<{ success: boolean; message: string; output?: string; error?: string }> => {
    const response = await apiClient.post(`/projects/${projectId}/database/setup-prisma`);
    return response.data;
  },

  /**
   * Crea/inicializa la base de datos
   */
  create: async (
    projectId: string,
    command?: 'migrate' | 'push'
  ): Promise<CreateDatabaseResponse> => {
    const response = await apiClient.post(`/projects/${projectId}/database/create`, { command });
    return response.data;
  },
};

