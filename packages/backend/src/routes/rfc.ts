import { Router, Request, Response } from 'express';
import { RFCGeneratorService } from '../services/rfcGeneratorService';
import { GenerateRFCRequest } from '@devflow-studio/shared';

const router = Router();
const rfcService = new RFCGeneratorService();

// Generate RFC from PRD and Stories
router.post('/generate', async (req: Request, res: Response) => {
  try {
    console.log('[RFC Route] POST /api/rfc/generate - Request received');
    const data: GenerateRFCRequest = req.body;
    
    console.log('[RFC Route] Request data:', {
      project_id: data.project_id,
      prd_id: data.prd_id,
      story_ids: data.story_ids?.length || 0,
      user_flow_id: data.user_flow_id,
      options: data.options
    });
    
    if (!data.project_id || !data.prd_id) {
      console.error('[RFC Route] Missing required fields:', {
        has_project_id: !!data.project_id,
        has_prd_id: !!data.prd_id
      });
      return res.status(400).json({ 
        error: 'project_id and prd_id are required' 
      });
    }

    console.log('[RFC Route] Calling rfcService.generateRFC...');
    const result = await rfcService.generateRFC(data);
    console.log('[RFC Route] ✅ RFC generation started:', result);
    res.json(result);
  } catch (error: any) {
    console.error('[RFC Route] ❌ Error generating RFC:', error);
    console.error('[RFC Route] Error message:', error.message);
    console.error('[RFC Route] Error stack:', error.stack);
    console.error('[RFC Route] Error details:', {
      name: error.name,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint
    });
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
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

// Update RFC status (approve, reject, etc.)
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    
    // Validate status value
    const validStatuses = ['draft', 'review', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }
    
    const rfc = await rfcService.updateRFCStatus(id, status);
    res.json(rfc);
  } catch (error: any) {
    console.error('Error updating RFC status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve RFC (convenience endpoint)
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rfc = await rfcService.updateRFCStatus(id, 'approved');
    res.json({ 
      message: 'RFC approved successfully',
      rfc 
    });
  } catch (error: any) {
    console.error('Error approving RFC:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
