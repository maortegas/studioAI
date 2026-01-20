import { Router, Request, Response } from 'express';
import { DatabaseService } from '../services/databaseService';
import { ProjectRepository } from '../repositories/projectRepository';

// mergeParams: true allows the router to access params from parent route
const router = Router({ mergeParams: true });
const databaseService = new DatabaseService();

/**
 * GET /api/projects/:id/database/status
 * Obtiene el estado de la base de datos del proyecto
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    console.log('[DatabaseRouter] GET /status - projectId:', projectId);
    console.log('[DatabaseRouter] req.params:', req.params);
    console.log('[DatabaseRouter] req.url:', req.url);
    
    if (!projectId) {
      console.error('[DatabaseRouter] Project ID is missing');
      return res.status(400).json({ error: 'Project ID is required' });
    }

    console.log('[DatabaseRouter] Checking if project has Prisma...');
    const hasPrisma = await databaseService.hasPrisma(projectId);
    console.log('[DatabaseRouter] hasPrisma:', hasPrisma);
    
    if (!hasPrisma) {
      return res.json({
        hasPrisma: false,
        status: 'not_configured',
        message: 'This project does not have Prisma configured',
      });
    }

    const status = await databaseService.getDatabaseStatus(projectId);
    console.log('[DatabaseRouter] Database status:', status);
    res.json({
      hasPrisma: true,
      status,
    });
  } catch (error: any) {
    console.error('[DatabaseRouter] Error getting database status:', error);
    console.error('[DatabaseRouter] Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/projects/:id/database/docker-status
 * Obtiene el estado de Docker para el proyecto
 */
router.get('/docker-status', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const dockerStatus = await databaseService.getDockerStatus(projectId);
    res.json(dockerStatus);
  } catch (error: any) {
    console.error('[DatabaseRouter] Error getting docker status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/projects/:id/database/generate-infrastructure
 * Genera la infraestructura de base de datos (docker-compose.yml, .env) sin requerir Prisma
 */
router.post('/generate-infrastructure', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    console.log(`[DatabaseRouter] POST /generate-infrastructure - projectId: ${projectId}`);
    
    if (!projectId) {
      console.error('[DatabaseRouter] Project ID is missing');
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const projectRepo = new ProjectRepository();
    const project = await projectRepo.findById(projectId);
    
    if (!project) {
      console.error('[DatabaseRouter] Project not found:', projectId);
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log(`[DatabaseRouter] Generating infrastructure for project: ${project.name} at ${project.base_path}`);
    await databaseService.generateDatabaseInfrastructure(project.base_path, project.name);
    
    console.log('[DatabaseRouter] Infrastructure generated successfully');
    res.json({
      success: true,
      message: 'Database infrastructure generated successfully',
    });
  } catch (error: any) {
    console.error('[DatabaseRouter] Error generating infrastructure:', error);
    console.error('[DatabaseRouter] Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/projects/:id/database/setup-prisma
 * Instala e inicializa Prisma en el proyecto
 */
router.post('/setup-prisma', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    console.log(`[DatabaseRouter] POST /setup-prisma - projectId: ${projectId}`);
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const result = await databaseService.setupPrisma(projectId);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Prisma installed and initialized successfully',
        output: result.output,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        output: result.output,
      });
    }
  } catch (error: any) {
    console.error('[DatabaseRouter] Error setting up Prisma:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/projects/:id/database/create
 * Crea/inicializa la base de datos del proyecto
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const { command } = req.body; // 'migrate' | 'push', default: 'push'
    console.log(`[DatabaseRouter] Creating database for project ${projectId} with command: ${command || 'push'}`);
    
    const result = await databaseService.createDatabase(projectId, command || 'push');
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Database created successfully',
        output: result.output,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        output: result.output,
      });
    }
  } catch (error: any) {
    console.error('[DatabaseRouter] Error creating database:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

