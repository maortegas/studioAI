import { Router, Request, Response } from 'express';
import { AIService } from '../services/aiService';
import { TaskRepository } from '../repositories/taskRepository';
import { ArtifactService } from '../services/artifactService';
import { ProjectRepository } from '../repositories/projectRepository';

const router = Router();
const aiService = new AIService();
const taskRepo = new TaskRepository();
const artifactService = new ArtifactService();
const projectRepo = new ProjectRepository();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { project_id } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Get all user stories
    const stories = await taskRepo.findByProjectIdAndType(project_id, 'story');
    
    if (stories.length === 0) {
      return res.status(400).json({ error: 'No user stories found. Create user stories first.' });
    }

    // Generate roadmap using AI
    const promptBundle = await aiService.buildPromptBundle(project_id);
    const roadmapPrompt = `${promptBundle}

Based on the above information, create a roadmap with milestones and task ordering.
For each milestone, specify:
- Milestone name
- Tasks/stories included
- Estimated completion date
- Dependencies

Format the output as a structured roadmap.`;

    // Create AI job for roadmap generation
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor', // Default provider
      mode: 'plan',
      prompt: roadmapPrompt,
    });

    res.json({ job_id: job.id, message: 'Roadmap generation started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    
    // Get roadmap artifact
    const roadmap = await artifactService.getArtifactByType(projectId, 'roadmap');
    const milestones = await taskRepo.findByProjectIdAndType(projectId, 'milestone');
    
    res.json({
      roadmap,
      milestones,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

