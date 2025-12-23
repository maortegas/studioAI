import { Router, Request, Response } from 'express';
import { RFCGeneratorService } from '../services/rfcGeneratorService';
import { GenerateRFCRequest } from '@devflow-studio/shared';

const router = Router();
const rfcService = new RFCGeneratorService();

// Generate RFC from PRD and Stories
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const data: GenerateRFCRequest = req.body;
    
    if (!data.project_id || !data.prd_id) {
      return res.status(400).json({ 
        error: 'project_id and prd_id are required' 
      });
    }

    const result = await rfcService.generateRFC(data);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating RFC:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get RFC by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rfc = await rfcService.getRFCById(id);
    
    if (!rfc) {
      return res.status(404).json({ error: 'RFC not found' });
    }
    
    res.json(rfc);
  } catch (error: any) {
    console.error('Error fetching RFC:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all RFCs for a project
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const rfcs = await rfcService.getRFCsByProject(projectId);
    res.json(rfcs);
  } catch (error: any) {
    console.error('Error fetching RFCs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get API contracts for an RFC
router.get('/:id/api-contracts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const contracts = await rfcService.getAPIContracts(id);
    res.json(contracts);
  } catch (error: any) {
    console.error('Error fetching API contracts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get database schemas for an RFC
router.get('/:id/database-schemas', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schemas = await rfcService.getDatabaseSchemas(id);
    res.json(schemas);
  } catch (error: any) {
    console.error('Error fetching database schemas:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
