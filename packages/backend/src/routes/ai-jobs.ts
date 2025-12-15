import { Router, Request, Response } from 'express';
import { AIService } from '../services/aiService';
import { ArtifactService } from '../services/artifactService';
import { ExecuteAIJobRequest } from '@devflow-studio/shared';

const router = Router();
const aiService = new AIService();
const artifactService = new ArtifactService();

router.post('/execute', async (req: Request, res: Response) => {
  try {
    const request: ExecuteAIJobRequest = req.body;
    
    if (!request.project_id || !request.provider || !request.mode) {
      return res.status(400).json({ 
        error: 'project_id, provider, and mode are required' 
      });
    }

    const job = await aiService.createAIJob(request);
    res.status(201).json(job);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/save-result', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { project_id, content, type } = req.body;

    if (!project_id || !content || !type) {
      return res.status(400).json({ 
        error: 'project_id, content, and type are required' 
      });
    }

    let artifact;
    if (type === 'architecture') {
      artifact = await artifactService.saveArchitecture(project_id, content);
    } else {
      return res.status(400).json({ error: 'Unsupported artifact type' });
    }

    res.json({ artifact, message: 'Artifact saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const jobs = await aiService.getJobsByProject(req.params.projectId);
    res.json(jobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await aiService.getJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'AI Job not found' });
    }
    res.json(job);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/result', async (req: Request, res: Response) => {
  try {
    const { AIJobRepository } = await import('../repositories/aiJobRepository');
    const aiJobRepo = new AIJobRepository();
    
    const events = await aiJobRepo.getEvents(req.params.id);
    const completedEvent = events.find(e => e.event_type === 'completed');
    
    if (!completedEvent) {
      return res.status(404).json({ error: 'Job result not found or job not completed' });
    }
    
    res.json({ output: completedEvent.payload?.output || '' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
