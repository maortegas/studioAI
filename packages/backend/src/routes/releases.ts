import express, { Request, Response } from 'express';
import { ReleaseService } from '../services/releaseService';
import { DeploymentService, DeploymentEnvironment } from '../services/deploymentService';
import { CreateReleaseRequest, UpdateReleaseRequest } from '@devflow-studio/shared';

const router = express.Router();
const releaseService = new ReleaseService();
const deploymentService = new DeploymentService();

// Get all releases for a project
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const releases = await releaseService.getReleasesByProject(projectId);
    res.json(releases);
  } catch (error: any) {
    console.error('Error fetching releases:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get release summary for a project
router.get('/project/:projectId/summary', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const summary = await releaseService.getReleaseSummary(projectId);
    res.json(summary);
  } catch (error: any) {
    console.error('Error fetching release summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific release
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const release = await releaseService.getRelease(id);
    res.json(release);
  } catch (error: any) {
    console.error('Error fetching release:', error);
    if (error.message === 'Release not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Create a new release
router.post('/', async (req: Request, res: Response) => {
  try {
    const data: CreateReleaseRequest = req.body;
    
    if (!data.project_id || !data.version) {
      return res.status(400).json({ error: 'project_id and version are required' });
    }

    const release = await releaseService.createRelease(data);
    res.status(201).json(release);
  } catch (error: any) {
    console.error('Error creating release:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a release
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data: UpdateReleaseRequest = req.body;
    
    const release = await releaseService.updateRelease(id, data);
    res.json(release);
  } catch (error: any) {
    console.error('Error updating release:', error);
    if (error.message === 'Release not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Publish a release
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const release = await releaseService.publishRelease(id);
    res.json(release);
  } catch (error: any) {
    console.error('Error publishing release:', error);
    if (error.message === 'Release not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Delete a release
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await releaseService.deleteRelease(id);
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting release:', error);
    if (error.message === 'Release not found' || error.message.includes('Only draft')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Generate deployment package (staging or production)
router.post('/project/:projectId/deploy/:environment', async (req: Request, res: Response) => {
  try {
    const { projectId, environment } = req.params;
    const { release_id, version, database_url, api_port, frontend_port, node_env } = req.body;

    if (environment !== 'staging' && environment !== 'production') {
      return res.status(400).json({ error: 'Environment must be "staging" or "production"' });
    }

    const config = {
      environment: environment as DeploymentEnvironment,
      release_id,
      version,
      database_url,
      api_port: api_port ? parseInt(api_port) : undefined,
      frontend_port: frontend_port ? parseInt(frontend_port) : undefined,
      node_env,
    };

    const result = await deploymentService.generateDeployment(projectId, config);
    res.json({
      message: `Deployment package generated successfully for ${environment}`,
      files: result,
    });
  } catch (error: any) {
    console.error('Error generating deployment:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
