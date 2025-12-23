import { Router, Request, Response } from 'express';
import { UserStoryGeneratorService } from '../services/userStoryGeneratorService';
import { GenerateStoriesRequest, ImportStoriesRequest } from '@devflow-studio/shared';

const router = Router();
const storyService = new UserStoryGeneratorService();

// Generate stories from PRD
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const data: GenerateStoriesRequest = req.body;
    
    if (!data.project_id || !data.prd_id) {
      return res.status(400).json({ 
        error: 'project_id and prd_id are required' 
      });
    }

    const response = await storyService.generateStoriesFromPRD(data);
    res.json(response);
  } catch (error: any) {
    console.error('Error generating stories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import stories from JSON or Markdown
router.post('/import', async (req: Request, res: Response) => {
  try {
    const data: ImportStoriesRequest = req.body;
    
    if (!data.project_id || !data.format || !data.content) {
      return res.status(400).json({ 
        error: 'project_id, format, and content are required' 
      });
    }

    // TODO: Implement import logic
    res.status(501).json({ error: 'Import functionality not yet implemented' });
  } catch (error: any) {
    console.error('Error importing stories:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
