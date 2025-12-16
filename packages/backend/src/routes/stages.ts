import { Router, Request, Response } from 'express';
import { ProjectRepository } from '../repositories/projectRepository';
import { ArtifactRepository } from '../repositories/artifactRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { ProjectStage, StageName, StageStatus } from '@devflow-studio/shared';
import { Pool } from 'pg';
import pool from '../config/database';

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
    const qaSessionsResult = await pool.query(
      'SELECT status, total_tests, passed_tests, failed_tests FROM qa_sessions WHERE project_id = $1',
      [projectId]
    );
    const qaSessions = qaSessionsResult.rows;
    const completedQASessions = qaSessions.filter((s: any) => s.status === 'completed');
    const totalQASessions = qaSessions.length;
    const runningQASessions = qaSessions.filter((s: any) => s.status === 'running' || s.status === 'pending').length;
    
    let qaCompletion = 0;
    let qaStatus: StageStatus = 'not_started';
    let qaChecklist = [];
    let qaNextAction = '';
    
    if (totalQASessions > 0) {
      // Calculate completion based on passed tests across all sessions
      const totalTests = qaSessions.reduce((sum: number, s: any) => sum + (s.total_tests || 0), 0);
      const totalPassed = qaSessions.reduce((sum: number, s: any) => sum + (s.passed_tests || 0), 0);
      const totalFailed = qaSessions.reduce((sum: number, s: any) => sum + (s.failed_tests || 0), 0);
      
      if (totalTests > 0) {
        qaCompletion = Math.round((totalPassed / totalTests) * 100);
      } else {
        qaCompletion = completedQASessions.length > 0 ? 50 : 0;
      }
      
      qaStatus = qaCompletion === 100 && totalFailed === 0 ? 'done' 
        : runningQASessions > 0 ? 'in_progress' 
        : totalQASessions > 0 ? 'in_progress' 
        : 'not_started';
      
      qaChecklist = [
        { 
          id: '1', 
          label: `QA sessions completed (${completedQASessions.length}/${totalQASessions})`, 
          completed: completedQASessions.length === totalQASessions && totalQASessions > 0
        },
        { 
          id: '2', 
          label: `Tests passed: ${totalPassed}/${totalTests}`, 
          completed: totalFailed === 0 && totalTests > 0
        },
        { 
          id: '3', 
          label: `Active QA sessions: ${runningQASessions}`, 
          completed: runningQASessions > 0
        },
      ];
      
      qaNextAction = qaCompletion === 100 && totalFailed === 0
        ? undefined
        : runningQASessions > 0
        ? `${runningQASessions} QA session(s) in progress`
        : totalFailed > 0
        ? `${totalFailed} test(s) failed - review and fix`
        : 'QA will run automatically after coding sessions';
    } else {
      // Check if we have completed coding sessions
      const codingSessionsResult = await pool.query(
        'SELECT COUNT(*) as count FROM coding_sessions WHERE project_id = $1 AND status = $2',
        [projectId, 'completed']
      );
      const completedCodingSessions = parseInt(codingSessionsResult.rows[0]?.count || '0');
      
      if (completedCodingSessions > 0) {
        qaChecklist = [
          { id: '1', label: `${completedCodingSessions} coding session(s) completed`, completed: true },
          { id: '2', label: 'QA sessions started', completed: false },
        ];
        qaStatus = 'in_progress';
        qaCompletion = 25;
        qaNextAction = 'QA will start automatically';
      } else {
        qaChecklist = [
          { id: '1', label: 'Complete coding sessions first', completed: false },
        ];
        qaNextAction = 'Complete implementation stage first';
      }
    }
    
    stages.push({
      name: 'qa',
      status: qaStatus,
      completion: qaCompletion,
      checklist: qaChecklist,
      next_action: qaNextAction,
    });

    // Release stage
    const releaseSummary = await pool.query(
      `SELECT 
        COUNT(*) as total_releases,
        COUNT(*) FILTER (WHERE status = 'published') as published_releases
      FROM releases
      WHERE project_id = $1`,
      [projectId]
    );
    const totalReleases = parseInt(releaseSummary.rows[0]?.total_releases || '0');
    const publishedReleases = parseInt(releaseSummary.rows[0]?.published_releases || '0');
    
    let releaseStatus: 'not_started' | 'in_progress' | 'blocked' | 'done' = 'not_started';
    let releaseCompletion = 0;
    const releaseChecklist = [];
    let releaseNextAction = 'Create your first release';
    
    if (totalReleases > 0) {
      releaseStatus = publishedReleases > 0 ? 'done' : 'in_progress';
      releaseCompletion = publishedReleases > 0 ? 100 : Math.min(50, totalReleases * 25);
      
      releaseChecklist.push({
        id: '1',
        label: `${totalReleases} release(s) created`,
        completed: true,
      });
      
      if (publishedReleases > 0) {
        releaseChecklist.push({
          id: '2',
          label: `${publishedReleases} release(s) published`,
          completed: true,
        });
        releaseNextAction = 'Release stage completed';
      } else {
        releaseChecklist.push({
          id: '2',
          label: 'Publish a release',
          completed: false,
        });
        releaseNextAction = 'Publish a release to complete this stage';
      }
    } else {
      releaseChecklist.push({
        id: '1',
        label: 'Create a release',
        completed: false,
      });
    }
    
    stages.push({
      name: 'release',
      status: releaseStatus,
      completion: releaseCompletion,
      checklist: releaseChecklist,
      next_action: releaseNextAction,
    });

    res.json(stages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

