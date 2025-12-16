import { Router, Request, Response } from 'express';
import { TestSuiteService } from '../services/testSuiteService';
import { CreateTestSuiteRequest, UpdateTestSuiteRequest } from '@devflow-studio/shared';

const router = Router();
const testSuiteService = new TestSuiteService();

// Get test suites for a coding session
router.get('/session/:codingSessionId', async (req: Request, res: Response) => {
  try {
    const codingSessionId = req.params.codingSessionId;
    const suites = await testSuiteService.getTestSuitesForSession(codingSessionId);
    res.json(suites);
  } catch (error: any) {
    console.error('Error fetching test suites:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single test suite
router.get('/:suiteId', async (req: Request, res: Response) => {
  try {
    const suiteId = req.params.suiteId;
    const suite = await testSuiteService.getTestSuite(suiteId);
    
    if (!suite) {
      return res.status(404).json({ error: 'Test suite not found' });
    }
    
    res.json(suite);
  } catch (error: any) {
    console.error('Error fetching test suite:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create test suite
router.post('/', async (req: Request, res: Response) => {
  try {
    const data: CreateTestSuiteRequest = req.body;
    
    if (!data.project_id || !data.name || !data.test_type) {
      return res.status(400).json({ error: 'project_id, name, and test_type are required' });
    }
    
    const suite = await testSuiteService.createTestSuite(data);
    res.json(suite);
  } catch (error: any) {
    console.error('Error creating test suite:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update test suite
router.put('/:suiteId', async (req: Request, res: Response) => {
  try {
    const suiteId = req.params.suiteId;
    const data: UpdateTestSuiteRequest = req.body;
    
    const suite = await testSuiteService.updateTestSuite(suiteId, data);
    
    if (!suite) {
      return res.status(404).json({ error: 'Test suite not found' });
    }
    
    res.json(suite);
  } catch (error: any) {
    console.error('Error updating test suite:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute test suite
router.post('/:suiteId/execute', async (req: Request, res: Response) => {
  try {
    const suiteId = req.params.suiteId;
    const executionType = req.body.execution_type || 'manual';
    
    const execution = await testSuiteService.executeTestSuite(suiteId, executionType);
    res.json({ execution, message: 'Test execution started' });
  } catch (error: any) {
    console.error('Error executing test suite:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete test suite
router.delete('/:suiteId', async (req: Request, res: Response) => {
  try {
    const suiteId = req.params.suiteId;
    await testSuiteService.deleteTestSuite(suiteId);
    res.json({ message: 'Test suite deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting test suite:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
