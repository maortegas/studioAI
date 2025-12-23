import express, { Request, Response } from 'express';
import { ProjectReviewService } from '../services/projectReviewService';

const router = express.Router();
const reviewService = new ProjectReviewService();

// Start project review
router.post('/project/:projectId/start', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const result = await reviewService.startProjectReview(projectId);
    res.json(result);
  } catch (error: any) {
    console.error('Error starting project review:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stop project review
router.post('/project/:projectId/stop', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    await reviewService.stopProjectReview(projectId);
    res.json({ message: 'Review stopped successfully' });
  } catch (error: any) {
    console.error('Error stopping project review:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get review status
router.get('/project/:projectId/status', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const status = await reviewService.getReviewStatus(projectId);
    res.json(status);
  } catch (error: any) {
    console.error('Error getting review status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fix selected errors
router.post('/project/:projectId/fix-errors', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { error_ids } = req.body; // Array of actionable item IDs to fix
    
    if (!error_ids || !Array.isArray(error_ids) || error_ids.length === 0) {
      return res.status(400).json({ error: 'error_ids array is required' });
    }

    const result = await reviewService.fixSelectedErrors(projectId, error_ids);
    res.json(result);
  } catch (error: any) {
    console.error('Error fixing selected errors:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file content
router.get('/project/:projectId/file', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { path } = req.query;
    
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'path parameter is required' });
    }

    const result = await reviewService.getFileContent(projectId, path);
    res.json(result);
  } catch (error: any) {
    console.error('Error getting file content:', error);
    res.status(500).json({ error: error.message });
  }
});

// Open file in editor
router.post('/project/:projectId/file/open', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { path, line } = req.body;
    
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }

    await reviewService.openFileInEditor(projectId, path, line);
    res.json({ message: 'File opened in editor' });
  } catch (error: any) {
    console.error('Error opening file in editor:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run single error command
router.post('/project/:projectId/run-error', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { error_id, category } = req.body;
    
    if (!error_id || !category) {
      return res.status(400).json({ error: 'error_id and category are required' });
    }

    const result = await reviewService.runSingleError(projectId, error_id, category);
    res.json(result);
  } catch (error: any) {
    console.error('Error running single error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save file content
router.post('/project/:projectId/file/save', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { path, content } = req.body;
    
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content is required' });
    }

    await reviewService.saveFileContent(projectId, path, content);
    res.json({ message: 'File saved successfully' });
  } catch (error: any) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: error.message });
  }
});

// SSE stream for real-time updates
router.get('/project/:projectId/stream', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', projectId })}\n\n`);

  // Subscribe to review events
  const unsubscribe = reviewService.subscribeToEvents(projectId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Clean up on client disconnect
  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});

export default router;

