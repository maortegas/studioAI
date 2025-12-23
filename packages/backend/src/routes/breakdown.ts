import { Router, Request, Response } from 'express';
import { BreakdownService } from '../services/breakdownService';
import { BreakdownRequest } from '@devflow-studio/shared';

const router = Router();
const breakdownService = new BreakdownService();

// Generate breakdown (épicas and tasks) from RFC
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const data: BreakdownRequest = req.body;
    
    if (!data.project_id || !data.rfc_id) {
      return res.status(400).json({ 
        error: 'project_id and rfc_id are required' 
      });
    }

    const result = await breakdownService.generateBreakdown(data);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating breakdown:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get epics by project
router.get('/epics/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const epics = await breakdownService.getEpicsByProject(projectId);
    res.json(epics);
  } catch (error: any) {
    console.error('Error fetching epics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get epics by RFC
router.get('/epics/rfc/:rfcId', async (req: Request, res: Response) => {
  try {
    const { rfcId } = req.params;
    const epics = await breakdownService.getEpicsByRFC(rfcId);
    res.json(epics);
  } catch (error: any) {
    console.error('Error fetching epics:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
