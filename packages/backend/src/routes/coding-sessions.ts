import { Router, Request, Response } from 'express';
import { CodingSessionService } from '../services/codingSessionService';
import { CreateCodingSessionRequest, StartImplementationRequest } from '@devflow-studio/shared';

const router = Router();
const sessionService = new CodingSessionService();

// Create a single coding session
router.post('/create', async (req: Request, res: Response) => {
  try {
    const data: CreateCodingSessionRequest = req.body;

    if (!data.project_id || !data.story_id || !data.programmer_type) {
      return res.status(400).json({ 
        error: 'project_id, story_id, and programmer_type are required' 
      });
    }

    const session = await sessionService.createSession(data);
    res.json(session);
  } catch (error: any) {
    console.error('Error creating coding session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start implementation for multiple stories
router.post('/start-implementation', async (req: Request, res: Response) => {
  try {
    const data: StartImplementationRequest = req.body;

    if (!data.project_id || !data.story_ids || data.story_ids.length === 0) {
      return res.status(400).json({ 
        error: 'project_id and story_ids are required' 
      });
    }

    const sessions = await sessionService.startImplementation(data);
    res.json({ 
      sessions, 
      message: `Started ${sessions.length} coding session(s)` 
    });
  } catch (error: any) {
    console.error('Error starting implementation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get implementation dashboard
router.get('/dashboard/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const dashboard = await sessionService.getDashboard(projectId);
    res.json(dashboard);
  } catch (error: any) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single session
router.get('/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const session = await sessionService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error: any) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all sessions for a project
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId;
    const sessions = await sessionService.getProjectSessions(projectId);
    res.json(sessions);
  } catch (error: any) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Server-Sent Events endpoint for real-time updates
router.get('/stream/:sessionId', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Function to send events to client
  const sendEvent = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Poll for new events every 1 second
  let lastEventTime = new Date();
  const pollInterval = setInterval(async () => {
    try {
      const events = await sessionService.getSessionEvents(sessionId, lastEventTime);
      
      if (events.length > 0) {
        for (const event of events) {
          sendEvent({
            type: event.event_type,
            payload: event.payload,
            timestamp: event.timestamp,
          });
          
          // Update last event time
          if (event.timestamp > lastEventTime) {
            lastEventTime = event.timestamp;
          }
        }
      }

      // Check if session is completed or failed
      const session = await sessionService.getSession(sessionId);
      if (session && (session.status === 'completed' || session.status === 'failed')) {
        sendEvent({
          type: 'session_ended',
          payload: { status: session.status },
          timestamp: new Date(),
        });
        clearInterval(pollInterval);
        res.end();
      }
    } catch (error) {
      console.error('Error polling events:', error);
    }
  }, 1000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(pollInterval);
    res.end();
  });
});

export default router;
