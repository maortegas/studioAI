import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { CreateTaskRequest, UpdateTaskRequest, TaskType } from '@devflow-studio/shared';

const router = Router();
const taskService = new TaskService();

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const tasks = await taskService.getTasksByProject(req.params.projectId);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/project/:projectId/type/:type', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as TaskType;
    const tasks = await taskService.getTasksByProjectAndType(req.params.projectId, type);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data: CreateTaskRequest = req.body;
    
    if (!data.project_id || !data.title || !data.type) {
      return res.status(400).json({ error: 'project_id, title, and type are required' });
    }

    const task = await taskService.createTask(data);
    res.status(201).json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const data: UpdateTaskRequest = req.body;
    const task = await taskService.updateTask(req.params.id, data);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await taskService.deleteTask(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Generate User Stories with AI
router.post('/stories/generate', async (req: Request, res: Response) => {
  try {
    const { project_id, count } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Import AIService to generate user stories
    const { AIService } = await import('../services/aiService');
    const aiService = new AIService();
    
    // Build prompt bundle which includes PRD COMPLETO (idea del proyecto)
    const promptBundle = await aiService.buildPromptBundle(project_id);
    
    // Verify PRD is included
    if (!promptBundle.includes('Product Requirements Document') && !promptBundle.includes('PRD')) {
      return res.status(400).json({ 
        error: 'PRD (Product Requirements Document) is required for user story generation. Please create the PRD first.' 
      });
    }
    
    // Get existing stories to avoid duplicates
    const existingStories = await taskService.getTasksByProjectAndType(project_id, 'story');
    const existingTitles = existingStories.map(s => s.title.toLowerCase());
    
    // Build comprehensive user stories prompt with complete PRD
    const storiesCount = count || 10;
    const userStoriesPrompt = `${promptBundle}

# User Stories Generation Task

Based on the COMPLETE Product Requirements Document (PRD) above, which contains the full idea and requirements of the project, generate ${storiesCount} comprehensive user stories.

The user stories must align with and support all requirements, objectives, and user needs described in the PRD.

## Format Requirements

Each user story must follow this format:

**As a** [type of user]
**I want** [goal/desire]
**So that** [benefit/value]

**Description:**
[Detailed description of the user story]

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

**Priority:** [0-10, where 10 is highest]

**Estimated Effort:** [Low/Medium/High]

Generate ${storiesCount} distinct user stories that cover different aspects of the project described in the PRD. Each story should be:
- Specific and actionable
- User-focused
- Aligned with project goals
- Independent and testable
- Properly prioritized based on importance

Output format: Return a JSON array where each element is:
{
  "title": "As a [user] I want [goal] so that [benefit]",
  "description": "Detailed description",
  "acceptance_criteria": ["Criterion 1", "Criterion 2", "Criterion 3"],
  "priority": 5
}

${existingTitles.length > 0 ? `\n**IMPORTANT:** Do NOT generate stories with these titles (already exist):\n${existingTitles.map(t => `- ${t}`).join('\n')}` : ''}

Return ONLY the JSON array, no additional text.`;

    // Create AI job for user stories generation
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor',
      mode: 'plan',
      prompt: userStoriesPrompt,
    });

    res.json({ job_id: job.id, message: 'User stories generation started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

