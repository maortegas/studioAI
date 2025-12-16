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
    // Get coding sessions
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;
    const sessionsResult = await pool.query(
      'SELECT status FROM coding_sessions WHERE project_id = $1',
      [projectId]
    );
    const sessions = sessionsResult.rows;
    const completedSessions = sessions.filter((s: any) => s.status === 'completed').length;
    const totalSessions = sessions.length;
    const runningSessions = sessions.filter((s: any) => s.status === 'running' || s.status === 'pending').length;
    
    // Calculate completion based on sessions if they exist, otherwise use stories
    let implementationCompletion = 0;
    let implementationStatus: StageStatus = 'not_started';
    let implementationChecklist = [];
    let nextAction = '';
    
    if (totalSessions > 0) {
      // Use sessions for calculation
      implementationCompletion = Math.round((completedSessions / totalSessions) * 100);
      implementationStatus = implementationCompletion === 100 ? 'done' 
        : runningSessions > 0 ? 'in_progress' 
        : totalSessions > 0 ? 'in_progress' 
        : 'not_started';
      
      implementationChecklist = [
        { 
          id: '1', 
          label: `Coding sessions (${completedSessions}/${totalSessions})`, 
          completed: implementationCompletion === 100 
        },
        { 
          id: '2', 
          label: `Active sessions: ${runningSessions}`, 
          completed: runningSessions > 0 
        },
      ];
      
      nextAction = implementationCompletion === 100 
        ? undefined 
        : runningSessions > 0 
        ? `${runningSessions} session(s) in progress` 
        : 'Start implementation sessions';
    } else if (stories.length > 0) {
      // Fallback to stories
      implementationChecklist = [
        { 
          id: '1', 
          label: `User stories created (${stories.length})`, 
          completed: true 
        },
        { 
          id: '2', 
          label: 'Coding sessions started', 
          completed: false 
        },
      ];
      implementationStatus = 'in_progress';
      implementationCompletion = 25;
      nextAction = 'Start coding sessions from user stories';
    } else {
      implementationChecklist = [
        { id: '1', label: 'User stories needed', completed: false },
      ];
      nextAction = 'Create user stories first';
    }
    
    stages.push({
      name: 'implementation',
      status: implementationStatus,
      completion: implementationCompletion,
      checklist: implementationChecklist,
      next_action: nextAction,
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

