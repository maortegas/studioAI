import { Router, Request, Response } from 'express';
import { AIService } from '../services/aiService';
import { ArtifactService } from '../services/artifactService';
import { ProjectRepository } from '../repositories/projectRepository';
import { ArtifactRepository } from '../repositories/artifactRepository';
import { readFile } from '../utils/fileSystem';
import path from 'path';

const router = Router();
const aiService = new AIService();
const artifactService = new ArtifactService();
const projectRepo = new ProjectRepository();
const artifactRepo = new ArtifactRepository();

/**
 * Generate architecture documentation using AI
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { project_id, provider = 'cursor' } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Get project to verify it exists
    const project = await projectRepo.findById(project_id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Build prompt bundle with PRD context
    const promptBundle = await aiService.buildPromptBundle(project_id);
    
    const architecturePrompt = `${promptBundle}

Based on the Product Requirements Document and project information above, generate comprehensive architecture documentation including:

1. System Architecture Overview
   - High-level system design
   - Component diagram
   - Technology stack decisions

2. Architectural Decision Records (ADRs)
   - ADR-0001: Technology Stack Selection
   - ADR-0002: Architecture Pattern
   - ADR-0003: Database Design
   - Additional ADRs as needed

3. Component Details
   - Frontend architecture
   - Backend architecture
   - Database schema
   - API design
   - Integration points

4. Non-functional Requirements
   - Scalability considerations
   - Security architecture
   - Performance considerations
   - Deployment architecture

Format the output as structured Markdown documentation.`;

    // Create AI job for architecture generation
    const job = await aiService.createAIJob({
      project_id,
      provider,
      mode: 'plan',
      prompt: architecturePrompt,
    });

    res.json({ 
      job_id: job.id, 
      message: 'Architecture documentation generation started',
      project_id 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get architecture documentation for a project
 */
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    
    // Get architecture artifact
    const architecture = await artifactRepo.findByProjectIdAndType(projectId, 'architecture');
    
    // Get ADRs
    const allArtifacts = await artifactRepo.findByProjectId(projectId);
    const adrs = allArtifacts.filter(a => a.type === 'adr').sort((a, b) => 
      a.path.localeCompare(b.path)
    );

    let architectureContent = null;
    if (architecture) {
      try {
        architectureContent = await readFile(architecture.path);
      } catch (error) {
        console.warn('Could not read architecture file:', error);
      }
    }

    res.json({
      architecture: architecture ? {
        ...architecture,
        content: architectureContent
      } : null,
      adrs: adrs.map(adr => ({
        id: adr.id,
        path: adr.path,
        created_at: adr.created_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

