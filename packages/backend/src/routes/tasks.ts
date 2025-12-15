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

export default router;

