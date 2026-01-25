import { useEffect, useState } from 'react';
import { databaseApi } from '../api/database';
import { useToast } from '../context/ToastContext';

interface DatabaseSetupProps {
  projectId: string;
}

export default function DatabaseSetup({ projectId }: DatabaseSetupProps) {
  const [hasPrisma, setHasPrisma] = useState<boolean | null>(null);
  const [dbStatus, setDbStatus] = useState<'not_configured' | 'not_initialized' | 'initialized' | 'unknown' | 'loading'>('loading');
  const [dockerStatus, setDockerStatus] = useState<'not_configured' | 'stopped' | 'running' | 'unknown' | 'loading'>('loading');
  const [creating, setCreating] = useState(false);
  const [generatingInfrastructure, setGeneratingInfrastructure] = useState(false);
  const [settingUpPrisma, setSettingUpPrisma] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    checkStatus();
  }, [projectId]);

  const checkStatus = async () => {
    try {
      setError(null);
      console.log('[DatabaseSetup] Checking status for project:', projectId);
      
      // Verificar estado de la base de datos
      const dbStatusResult = await databaseApi.getStatus(projectId);
      console.log('[DatabaseSetup] Database status result:', dbStatusResult);
      setHasPrisma(dbStatusResult.hasPrisma);
      setDbStatus(dbStatusResult.status || 'unknown');

      // Verificar estado de Docker si tiene Prisma
      if (dbStatusResult.hasPrisma) {
        try {
          const dockerStatusResult = await databaseApi.getDockerStatus(projectId);
          console.log('[DatabaseSetup] Docker status result:', dockerStatusResult);
          setDockerStatus(dockerStatusResult.status || 'unknown');
        } catch (dockerErr: any) {
          console.error('[DatabaseSetup] Error getting docker status:', dockerErr);
          setDockerStatus('unknown');
        }
      } else {
        setDockerStatus('not_configured');
      }
    } catch (err: any) {
      console.error('[DatabaseSetup] Failed to check database status:', err);
      console.error('[DatabaseSetup] Error details:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
      setError(err.response?.data?.error || err.message || 'Failed to check database status');
      setDbStatus('unknown');
      setDockerStatus('unknown');
      setHasPrisma(false); // En caso de error, asumir que no tiene Prisma para mostrar mensaje
    }
  };

  const handleGenerateInfrastructure = async () => {
    setGeneratingInfrastructure(true);
    setError(null);

    try {
      const result = await databaseApi.generateInfrastructure(projectId);
      
      if (result.success) {
        showToast('Infraestructura de base de datos generada exitosamente', 'success');
        // Recargar estado para verificar si ahora tiene Prisma
        await checkStatus();
      } else {
        setError(result.message || 'Failed to generate infrastructure');
        showToast(result.message || 'Error al generar la infraestructura', 'error');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to generate infrastructure';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setGeneratingInfrastructure(false);
    }
  };

  const handleSetupPrisma = async () => {
    setSettingUpPrisma(true);
    setError(null);

    try {
      const result = await databaseApi.setupPrisma(projectId);
      
      if (result.success) {
        showToast('Prisma instalado e inicializado exitosamente', 'success');
        // Recargar estado para verificar si ahora tiene Prisma
        await checkStatus();
      } else {
        const errorMsg = result.error || result.message || 'Failed to setup Prisma';
        setError(errorMsg);
        showToast(errorMsg, 'error');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to setup Prisma';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setSettingUpPrisma(false);
    }
  };

  const handleCreateDatabase = async () => {
    setCreating(true);
    setError(null);

    try {
      const result = await databaseApi.create(projectId, 'push');
      
      if (result.success) {
        showToast('Base de datos creada exitosamente', 'success');
        // Recargar estado
        await checkStatus();
      } else {
        const errorMsg = result.error || result.message || 'Failed to create database';
        setError(errorMsg);
        showToast(errorMsg, 'error');
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to create database';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setCreating(false);
    }
  };

  const isLoading = hasPrisma === null || dbStatus === 'loading' || dockerStatus === 'loading';

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
        Database Setup
      </h2>

      {/* Estado de carga */}
      {isLoading && (
        <div className="mb-4">
          <p className="text-gray-600 dark:text-gray-400">Cargando información de la base de datos...</p>
        </div>
      )}

      {/* Mensaje si no tiene Prisma */}
      {!isLoading && hasPrisma === false && (
        <div className="mb-4 space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <p className="text-gray-700 dark:text-gray-300 mb-2">
              <strong>Este proyecto no tiene Prisma configurado.</strong>
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Puedes generar la infraestructura de base de datos (Docker Compose y configuración) ahora, 
              y luego instalar Prisma cuando estés listo.
            </p>
            
            <button
              onClick={handleGenerateInfrastructure}
              disabled={generatingInfrastructure}
              className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generatingInfrastructure ? 'Generando infraestructura...' : 'Generar Infraestructura de Base de Datos'}
            </button>
            
            {generatingInfrastructure && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Esto creará docker-compose.yml y .env con la configuración de PostgreSQL...
              </p>
            )}
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              <strong>Opciones para configurar Prisma:</strong>
            </p>
            
            <div className="space-y-3">
              <button
                onClick={handleSetupPrisma}
                disabled={settingUpPrisma}
                className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {settingUpPrisma ? 'Instalando e inicializando Prisma...' : '✨ Instalar e Inicializar Prisma Automáticamente'}
              </button>
              
              {settingUpPrisma && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Esto ejecutará: npm install prisma @prisma/client && npx prisma init
                </p>
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-600">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                <strong>O hacerlo manualmente:</strong>
              </p>
              <ol className="text-xs text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1 ml-2">
                <li>Instalar Prisma: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">npm install prisma @prisma/client</code></li>
                <li>Inicializar Prisma: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">npx prisma init</code></li>
                <li>Configurar tu schema en <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">prisma/schema.prisma</code></li>
                <li>Usar el botón "Crear Base de Datos" para inicializar la BD</li>
              </ol>
            </div>
          </div>
          
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">
                <strong>Error:</strong> {error}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Contenido principal - solo mostrar si tiene Prisma */}
      {!isLoading && hasPrisma === true && (
        <>
          {/* Estado de Docker */}
          {dockerStatus === 'running' && (
            <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-800 dark:text-green-200 flex items-center">
                <span className="mr-2">✅</span>
                PostgreSQL está corriendo en Docker
              </p>
            </div>
          )}

          {dockerStatus === 'stopped' && (
            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-center">
                <span className="mr-2">⚠️</span>
                PostgreSQL no está corriendo. El botón "Crear Base de Datos" iniciará Docker automáticamente.
              </p>
            </div>
          )}

          {dockerStatus === 'unknown' && (
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No se pudo verificar el estado de Docker.
              </p>
            </div>
          )}

          {/* Estado de la base de datos */}
          <div className="mb-4">
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              Prisma está configurado en este proyecto.
            </p>
            {dbStatus === 'not_initialized' && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400 mb-4">
                La base de datos aún no ha sido inicializada.
              </p>
            )}
            {dbStatus === 'initialized' && (
              <p className="text-sm text-green-600 dark:text-green-400 mb-4">
                ✅ La base de datos ya está inicializada.
              </p>
            )}
          </div>

          {/* Botón de acción */}
          {dbStatus === 'not_initialized' && (
            <div className="space-y-4">
              <button
                onClick={handleCreateDatabase}
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creando base de datos...' : 'Crear Base de Datos'}
              </button>
              {creating && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Esto puede tomar unos momentos. Por favor espera...
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200">
                <strong>Error:</strong> {error}
              </p>
              <button
                onClick={checkStatus}
                className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Información adicional */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <strong>Nota:</strong> Este proceso creará la base de datos usando Docker Compose y ejecutará las migraciones de Prisma.
              Asegúrate de tener Docker instalado y corriendo.
            </p>
          </div>
        </>
      )}

      {/* Mostrar error si existe y no se mostró arriba */}
      {error && hasPrisma !== true && !isLoading && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-800 dark:text-red-200">
            <strong>Error:</strong> {error}
          </p>
          <button
            onClick={checkStatus}
            className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Botón de recarga manual */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={checkStatus}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Actualizar estado
        </button>
      </div>
    </div>
  );
}
