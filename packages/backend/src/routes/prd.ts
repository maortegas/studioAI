import { Router, Request, Response } from 'express';
import { PRDService } from '../services/prdService';
import { CreatePRDRequest, UpdatePRDRequest } from '@devflow-studio/shared';

const router = Router();
const prdService = new PRDService();

// Get PRD by project ID
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const prd = await prdService.getPRDByProject(projectId);
    
    if (!prd) {
      return res.status(404).json({ error: 'PRD not found for this project' });
    }
    
    res.json(prd);
  } catch (error: any) {
    console.error('Error fetching PRD:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get PRD by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prd = await prdService.getPRDById(id);
    
    if (!prd) {
      return res.status(404).json({ error: 'PRD not found' });
    }
    
    res.json(prd);
  } catch (error: any) {
    console.error('Error fetching PRD:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create PRD
router.post('/', async (req: Request, res: Response) => {
  try {
    const data: CreatePRDRequest = req.body;
    
    if (!data.project_id || !data.vision || !data.personas) {
      return res.status(400).json({ 
        error: 'project_id, vision, and personas are required' 
      });
    }

    const prd = await prdService.createPRD(data);
    res.status(201).json(prd);
  } catch (error: any) {
    console.error('Error creating PRD:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update PRD
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data: UpdatePRDRequest = req.body;

    const prd = await prdService.updatePRD(id, data);
    res.json(prd);
  } catch (error: any) {
    console.error('Error updating PRD:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate PRD (marks as validated, required before next step)
router.post('/:id/validate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prd = await prdService.validatePRDDocument(id);
    res.json(prd);
  } catch (error: any) {
    console.error('Error validating PRD:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check if PRD is validated
router.get('/project/:projectId/validated', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const isValidated = await prdService.isPRDValidated(projectId);
    res.json({ validated: isValidated });
  } catch (error: any) {
    console.error('Error checking PRD validation:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
