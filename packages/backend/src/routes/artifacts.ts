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
    
    // Build prompt for architecture generation
    const promptBundle = await aiService.buildPromptBundle(project_id);
    const architecturePrompt = `${promptBundle}

Based on the above information, generate comprehensive architecture documentation including:
- System Architecture Overview
- Technology Stack Details
- Component Architecture
- Data Flow Diagrams (in text/markdown format)
- API Design (if applicable)
- Database Schema (if applicable)
- Deployment Architecture
- Security Considerations

Format the output as a well-structured markdown document.`;

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
