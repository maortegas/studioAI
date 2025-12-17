import { Router, Request, Response } from 'express';
import { IntegrationTestPlanService } from '../services/integrationTestPlanService';
import { CreateTestPlanRequest, UpdateTestPlanRequest } from '@devflow-studio/shared';

const router = Router();
const planService = new IntegrationTestPlanService();

// Generate test plan (for any test type)
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const data: CreateTestPlanRequest = req.body;

    if (!data.project_id || !data.test_type) {
      return res.status(400).json({ error: 'project_id and test_type are required' });
    }

    const plan = await planService.generatePlan(data);
    res.json({ plan, message: `${data.test_type} test plan generation started` });
  } catch (error: any) {
    console.error('Error generating test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get plan by ID
router.get('/:planId', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId;
    const plan = await planService.getPlan(planId);
    
    if (!plan) {
      return res.status(404).json({ error: 'Test plan not found' });
    }

    res.json(plan);
  } catch (error: any) {
    console.error('Error fetching test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get plan by QA session
router.get('/qa-session/:qaSessionId', async (req: Request, res: Response) => {
  try {
    const qaSessionId = req.params.qaSessionId;
    const plan = await planService.getPlanByQASession(qaSessionId);
    
    if (!plan) {
      return res.status(404).json({ error: 'Test plan not found for this QA session' });
    }

    res.json(plan);
  } catch (error: any) {
    console.error('Error fetching test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get plan by coding session
router.get('/coding-session/:codingSessionId', async (req: Request, res: Response) => {
  try {
    const codingSessionId = req.params.codingSessionId;
    const plan = await planService.getPlanByCodingSession(codingSessionId);
    
    if (!plan) {
      return res.status(404).json({ error: 'Test plan not found for this coding session' });
    }

    res.json(plan);
  } catch (error: any) {
    console.error('Error fetching test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update plan
router.put('/:planId', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId;
    const data: UpdateTestPlanRequest = req.body;

    const plan = await planService.updatePlan(planId, data);
    res.json({ plan, message: 'Test plan updated successfully' });
  } catch (error: any) {
    console.error('Error updating test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete plan
router.delete('/:planId', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId;
    await planService.deletePlan(planId);
    res.json({ message: 'Test plan deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute plan
router.post('/:planId/execute', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId;
    const result = await planService.executePlan(planId);
    res.json(result);
  } catch (error: any) {
    console.error('Error executing test plan:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
