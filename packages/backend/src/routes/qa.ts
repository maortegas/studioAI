import { Router, Request, Response } from 'express';
import { QAService } from '../services/qaService';
import { CreateQASessionRequest } from '@devflow-studio/shared';

const router = Router();
const qaService = new QAService();

// Create QA session
router.post('/create', async (req: Request, res: Response) => {
  try {
    const data: CreateQASessionRequest = req.body;

    if (!data.project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const session = await qaService.createSession(data);
    res.json(session);
  } catch (error: any) {
    console.error('Error creating QA session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get QA dashboard
router.get('/dashboard/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const dashboard = await qaService.getDashboard(projectId);
    res.json(dashboard);
  } catch (error: any) {
    console.error('Error fetching QA dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single session with results
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const report = await qaService.getSession(sessionId);
    
    if (!report) {
      return res.status(404).json({ error: 'QA session not found' });
    }

    res.json(report);
  } catch (error: any) {
    console.error('Error fetching QA session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all sessions for a project
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const sessions = await qaService.getProjectSessions(projectId);
    res.json(sessions);
  } catch (error: any) {
    console.error('Error fetching QA sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate tests manually
router.post('/generate-tests', async (req: Request, res: Response) => {
  try {
    const { project_id, coding_session_id } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const session = await qaService.generateTests(project_id, coding_session_id);
    res.json({ session, message: 'Test generation started' });
  } catch (error: any) {
    console.error('Error generating tests:', error);
    const errorMessage = error.message || String(error);
    
    // Provide user-friendly message for resource_exhausted errors
    if (errorMessage.includes('resource_exhausted') || errorMessage.includes('ConnectError')) {
      res.status(503).json({ 
        error: 'Service temporarily unavailable. The AI service is experiencing high load. Please try again in a few moments. The system will automatically retry.',
        retryable: true 
      });
    } else {
      res.status(500).json({ error: errorMessage });
    }
  }
});

// Run QA manually
router.post('/run/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    await qaService.startQASession(sessionId);
    res.json({ message: 'QA session started' });
  } catch (error: any) {
    console.error('Error starting QA session:', error);
    const errorMessage = error.message || String(error);
    
    // Provide user-friendly message for resource_exhausted errors
    if (errorMessage.includes('resource_exhausted') || errorMessage.includes('ConnectError')) {
      res.status(503).json({ 
        error: 'Service temporarily unavailable. The AI service is experiencing high load. Please try again in a few moments. The system will automatically retry.',
        retryable: true 
      });
    } else {
      res.status(500).json({ error: errorMessage });
    }
  }
});

// Get test files for a session
router.get('/session/:sessionId/tests', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const testFiles = await qaService.getTestFiles(sessionId);
    res.json(testFiles);
  } catch (error: any) {
    console.error('Error fetching test files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get test file content
router.get('/session/:sessionId/test/:fileName', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const fileName = decodeURIComponent(req.params.fileName);
    const content = await qaService.getTestFileContent(sessionId, fileName);
    res.json({ content });
  } catch (error: any) {
    console.error('Error fetching test file content:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update test file
router.put('/session/:sessionId/test/:fileName', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const fileName = decodeURIComponent(req.params.fileName);
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    await qaService.updateTestFile(sessionId, fileName, content);
    res.json({ message: 'Test file updated successfully' });
  } catch (error: any) {
    console.error('Error updating test file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete test file
router.delete('/session/:sessionId/test/:fileName', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const fileName = decodeURIComponent(req.params.fileName);
    
    await qaService.deleteTestFile(sessionId, fileName);
    res.json({ message: 'Test file deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting test file:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
