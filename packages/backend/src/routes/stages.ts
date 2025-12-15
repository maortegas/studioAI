import { Router, Request, Response } from 'express';
import { ProjectRepository } from '../repositories/projectRepository';
import { ArtifactRepository } from '../repositories/artifactRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { ProjectStage, StageName, StageStatus } from '@devflow-studio/shared';

const router = Router();
const projectRepo = new ProjectRepository();
const artifactRepo = new ArtifactRepository();
const taskRepo = new TaskRepository();

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const stages: ProjectStage[] = [];

    // Idea stage
    const prd = await artifactRepo.findByProjectIdAndType(projectId, 'prd');
    stages.push({
      name: 'idea',
      status: prd ? 'done' : 'not_started',
      completion: prd ? 100 : 0,
      checklist: [
        { id: '1', label: 'PRD created', completed: !!prd },
      ],
      next_action: prd ? undefined : 'Create PRD document',
    });

    // Design stage
    const architecture = await artifactRepo.findByProjectIdAndType(projectId, 'architecture');
    const adrs = (await artifactRepo.findByProjectId(projectId)).filter(a => a.type === 'adr');
    const designCompletion = architecture ? (adrs.length > 0 ? 100 : 75) : prd ? 25 : 0;
    const designStatus = architecture && adrs.length > 0 
      ? 'done' 
      : architecture 
      ? 'in_progress' 
      : prd 
      ? 'in_progress' 
      : 'not_started';
    stages.push({
      name: 'design',
      status: designStatus,
      completion: designCompletion,
      checklist: [
        { id: '1', label: 'Architecture documentation', completed: !!architecture },
        { id: '2', label: 'ADRs created', completed: adrs.length > 0 },
      ],
      next_action: architecture 
        ? (adrs.length === 0 ? 'Create ADRs' : undefined)
        : 'Generate or upload architecture documentation',
    });

    // Stories stage
    const stories = await taskRepo.findByProjectIdAndType(projectId, 'story');
    stages.push({
      name: 'stories',
      status: stories.length > 0 ? 'done' : architecture ? 'in_progress' : 'not_started',
      completion: stories.length > 0 ? 100 : architecture ? 50 : 0,
      checklist: [
        { id: '1', label: 'User stories created', completed: stories.length > 0 },
      ],
      next_action: stories.length > 0 ? undefined : 'Create user stories',
    });

    // Roadmap stage
    const roadmap = await artifactRepo.findByProjectIdAndType(projectId, 'roadmap');
    const milestones = await taskRepo.findByProjectIdAndType(projectId, 'milestone');
    stages.push({
      name: 'roadmap',
      status: roadmap ? 'done' : stories.length > 0 ? 'in_progress' : 'not_started',
      completion: roadmap ? 100 : stories.length > 0 ? 50 : 0,
      checklist: [
        { id: '1', label: 'Roadmap created', completed: !!roadmap },
        { id: '2', label: 'Milestones defined', completed: milestones.length > 0 },
      ],
      next_action: roadmap ? undefined : 'Generate or upload roadmap',
    });

    // Implementation stage
    const allTasks = await taskRepo.findByProjectId(projectId);
    const completedTasks = allTasks.filter(t => t.status === 'done').length;
    const totalTasks = allTasks.length;
    const completion = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
    stages.push({
      name: 'implementation',
      status: completion === 100 ? 'done' : completion > 0 ? 'in_progress' : 'not_started',
      completion,
      checklist: [
        { id: '1', label: 'Tasks completed', completed: completion === 100 },
      ],
      next_action: completion === 100 ? undefined : 'Continue implementing tasks',
    });

    // QA stage
    stages.push({
      name: 'qa',
      status: 'not_started',
      completion: 0,
      checklist: [
        { id: '1', label: 'QA tests completed', completed: false },
      ],
      next_action: 'Start QA testing',
    });

    // Release stage
    stages.push({
      name: 'release',
      status: 'not_started',
      completion: 0,
      checklist: [
        { id: '1', label: 'Release prepared', completed: false },
      ],
      next_action: 'Prepare release',
    });

    res.json(stages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

