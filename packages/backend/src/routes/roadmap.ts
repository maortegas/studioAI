import { Router, Request, Response } from 'express';
import { AIService } from '../services/aiService';
import { TaskRepository } from '../repositories/taskRepository';
import { ArtifactService } from '../services/artifactService';
import { ProjectRepository } from '../repositories/projectRepository';
import { RoadmapService } from '../services/roadmapService';
import { CreateRoadmapRequest, UpdateRoadmapRequest } from '@devflow-studio/shared';

const router = Router();
const aiService = new AIService();
const taskRepo = new TaskRepository();
const artifactService = new ArtifactService();
const projectRepo = new ProjectRepository();
const roadmapService = new RoadmapService();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    console.log('POST /api/roadmap/generate - Request received');
    const { project_id } = req.body;

    if (!project_id) {
      console.log('POST /api/roadmap/generate - Missing project_id');
      return res.status(400).json({ error: 'project_id is required' });
    }

    console.log(`POST /api/roadmap/generate - Getting stories for project: ${project_id}`);
    // Get all user stories
    const stories = await taskRepo.findByProjectIdAndType(project_id, 'story');
    
    if (stories.length === 0) {
      console.log('POST /api/roadmap/generate - No stories found');
      return res.status(400).json({ error: 'No user stories found. Create user stories first.' });
    }

    console.log(`POST /api/roadmap/generate - Found ${stories.length} stories, building prompt bundle`);
    // Generate roadmap using AI
    // Note: buildPromptBundle is called inside createAIJob, but we can pass additional prompt context
    const roadmapPrompt = `

Based on the above information, create a roadmap with milestones and task ordering.
For each milestone, specify:
- Milestone name
- Tasks/stories included
- Estimated completion date
- Dependencies

Format the output as a structured roadmap.`;

    console.log('POST /api/roadmap/generate - Creating AI job');
    // Create AI job for roadmap generation
    // buildPromptBundle will be called inside createAIJob, and we append our roadmap-specific prompt
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor', // Default provider
      mode: 'plan',
      prompt: roadmapPrompt, // This will be appended to the prompt bundle
    });

    console.log(`POST /api/roadmap/generate - AI job created: ${job.id}`);
    
    // Ensure response is sent before any async operations complete
    if (!res.headersSent) {
      res.json({ job_id: job.id, message: 'Roadmap generation started' });
    }
  } catch (error: any) {
    console.error('POST /api/roadmap/generate - Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
});

// Create roadmap manually
router.post('/create', async (req: Request, res: Response) => {
  try {
    const data: CreateRoadmapRequest = req.body;

    if (!data.project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    if (!data.title) {
      return res.status(400).json({ error: 'title is required' });
    }

    if (!data.milestones || data.milestones.length === 0) {
      return res.status(400).json({ error: 'At least one milestone is required' });
    }

    const roadmap = await roadmapService.createRoadmap(data);
    res.json(roadmap);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update roadmap manually
router.put('/update/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const data: UpdateRoadmapRequest = req.body;

    const roadmap = await roadmapService.updateRoadmap(projectId, data);
    res.json(roadmap);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    
    // Get roadmap using the service
    const roadmap = await roadmapService.getRoadmapByProject(projectId);
    const milestones = await taskRepo.findByProjectIdAndType(projectId, 'milestone');
    
    // Return consistent structure - if roadmap is null, return null for roadmap artifact
    res.json({
      roadmap: roadmap ? { content: roadmap } : null,
      milestones: milestones || [],
    });
  } catch (error: any) {
    console.error('Error in GET /project/:projectId:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;

