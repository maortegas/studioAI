import { Router, Request, Response } from 'express';
import { ArtifactService } from '../services/artifactService';
import multer from 'multer';
import { CreateArtifactRequest } from '@devflow-studio/shared';

const router = Router();
const artifactService = new ArtifactService();

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const artifacts = await artifactService.getArtifactsByProject(req.params.projectId);
    res.json(artifacts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const artifact = await artifactService.getArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/content', async (req: Request, res: Response) => {
  try {
    const content = await artifactService.readArtifactFile(req.params.id);
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/prd', async (req: Request, res: Response) => {
  try {
    const { project_id, content } = req.body;
    
    if (!project_id || !content) {
      return res.status(400).json({ error: 'project_id and content are required' });
    }

    const artifact = await artifactService.savePRD(project_id, content);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/architecture', async (req: Request, res: Response) => {
  try {
    const { project_id, content } = req.body;
    
    if (!project_id || !content) {
      return res.status(400).json({ error: 'project_id and content are required' });
    }

    const artifact = await artifactService.saveArchitecture(project_id, content);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/architecture/generate', async (req: Request, res: Response) => {
  try {
    const { project_id } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Import AIService to generate architecture
    const { AIService } = await import('../services/aiService');
    const aiService = new AIService();
    
    // Build prompt bundle which includes PRD COMPLETO (idea del proyecto)
    const promptBundle = await aiService.buildPromptBundle(project_id);
    
    // Verify PRD is included - critical for architecture generation
    if (!promptBundle.includes('Product Requirements Document') && !promptBundle.includes('PRD')) {
      return res.status(400).json({ 
        error: 'PRD (Product Requirements Document) is required for architecture generation. Please create the PRD first.' 
      });
    }
    
    // Build comprehensive architecture prompt with complete PRD
    const architecturePrompt = `${promptBundle}

# Architecture Generation Task

Based on the COMPLETE Product Requirements Document (PRD) above, which contains the full idea and requirements of the project, generate comprehensive architecture documentation.

The architecture must align with and support all requirements, objectives, constraints, and user needs described in the PRD.

Generate the following sections:

## System Architecture Overview
- High-level system architecture
- Main components and their relationships
- System boundaries and interfaces

## Technology Stack Details
- Programming languages and frameworks
- Libraries and dependencies
- Development tools
- Infrastructure components

## Component Architecture
- Detailed component breakdown
- Component responsibilities
- Component interactions and dependencies
- Data flow between components

## Data Flow Diagrams (in text/markdown format)
- User interactions flow
- Data processing flow
- System integration flow

## API Design (if applicable)
- API endpoints structure
- Request/response formats
- Authentication and authorization
- API versioning strategy

## Database Schema (if applicable)
- Database type and rationale
- Entity relationships
- Key tables and fields
- Indexing strategy

## Deployment Architecture
- Deployment environment
- Infrastructure requirements
- Scaling strategy
- Monitoring and logging

## Security Considerations
- Security threats and mitigations
- Authentication and authorization
- Data protection
- Compliance requirements

Format the output as a well-structured markdown document that can be saved directly to ARCHITECTURE.md.`;

    // Create AI job for architecture generation
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor', // Default provider
      mode: 'plan',
      prompt: architecturePrompt,
    });

    res.json({ job_id: job.id, message: 'Architecture generation started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/adr', async (req: Request, res: Response) => {
  try {
    const { project_id, content, adr_number } = req.body;
    
    if (!project_id || !content) {
      return res.status(400).json({ error: 'project_id and content are required' });
    }

    const artifact = await artifactService.saveADR(project_id, content, adr_number);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/project/:projectId/adr', async (req: Request, res: Response) => {
  try {
    const adrs = await artifactService.getADRsByProject(req.params.projectId);
    res.json(adrs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/adr/generate', async (req: Request, res: Response) => {
  try {
    const { project_id, decision_context } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Import AIService to generate ADR
    const { AIService } = await import('../services/aiService');
    const aiService = new AIService();
    
    // Build prompt bundle which includes PRD and Architecture
    const promptBundle = await aiService.buildPromptBundle(project_id);
    
    // Get existing ADRs to determine next number
    const existingADRs = await artifactService.getADRsByProject(project_id);
    const nextADRNumber = existingADRs.length + 1;
    
    // Build comprehensive ADR prompt
    const adrPrompt = `${promptBundle}

# Architectural Decision Record (ADR) Generation

Generate an ADR-${nextADRNumber.toString().padStart(3, '0')} based on the project context above.

${decision_context ? `## Decision Context\n${decision_context}\n\n` : ''}## ADR Template

Follow this ADR format:

# ADR-${nextADRNumber.toString().padStart(3, '0')}: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
[Describe the issue motivating this decision or change. This is the "why" of the decision.]

## Decision
[Describe the change that we're proposing or have agreed to implement. This is the "what" of the decision.]

## Consequences
[Describe the consequences, both positive and negative, of this decision. This is the "what happens" as a result of the decision.]

## Alternatives Considered
[List the alternatives that were considered, and why they were rejected.]

## Notes
[Any additional notes or considerations.]

Generate a complete, well-structured ADR that aligns with the project's architecture and requirements described in the PRD and Architecture documentation above.`;

    // Create AI job for ADR generation
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor',
      mode: 'plan',
      prompt: adrPrompt,
    });

    res.json({ 
      job_id: job.id, 
      adr_number: nextADRNumber,
      message: 'ADR generation started' 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/adr/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await artifactService.deleteADR(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'ADR not found' });
    }
    res.json({ message: 'ADR deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const data: CreateArtifactRequest = req.body;
    
    if (!data.project_id || !data.type || !data.path) {
      return res.status(400).json({ error: 'project_id, type, and path are required' });
    }

    let fileContent: string | undefined;
    if (req.file) {
      const fs = require('fs');
      fileContent = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path); // Clean up temp file
    }

    const artifact = await artifactService.saveArtifact(data, fileContent);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
