import { Router, Request, Response } from 'express';
import { CodingSessionService } from '../services/codingSessionService';
import { ReviewService } from '../services/reviewService';
import { CreateCodingSessionRequest, StartImplementationRequest } from '@devflow-studio/shared';

const router = Router();
const sessionService = new CodingSessionService();
const reviewService = new ReviewService();

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

// Pause a session
router.post('/:sessionId/pause', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    await sessionService.pauseSession(sessionId);
    res.json({ message: 'Session paused successfully' });
  } catch (error: any) {
    console.error('Error pausing session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Resume a session
router.post('/:sessionId/resume', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    await sessionService.resumeSession(sessionId);
    res.json({ message: 'Session resumed successfully' });
  } catch (error: any) {
    console.error('Error resuming session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete/Cancel a session
router.delete('/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    await sessionService.deleteSession(sessionId);
    res.json({ message: 'Session deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Retry a failed session
router.post('/:sessionId/retry', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const newSession = await sessionService.retrySession(sessionId);
    res.json({ session: newSession, message: 'Session retried successfully' });
  } catch (error: any) {
    console.error('Error retrying session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Retry a failed session with custom user instructions
router.post('/:sessionId/retry-with-instructions', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { instructions } = req.body;

    if (!instructions || !instructions.trim()) {
      return res.status(400).json({ error: 'Instructions are required' });
    }

    const result = await sessionService.retrySessionWithInstructions(sessionId, instructions);
    res.json(result);
  } catch (error: any) {
    console.error('Error retrying session with instructions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start review process for a completed session
router.post('/:sessionId/review', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId;
    const result = await reviewService.startReview(sessionId);
    res.json(result);
  } catch (error: any) {
    console.error('Error starting review:', error);
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
  let sessionEndedTime: Date | null = null;
  let finalEventsSent = false;

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
        // Mark when session ended (only once)
        if (!sessionEndedTime) {
          sessionEndedTime = new Date();
          console.log(`[SSE] Session ${sessionId} ended with status: ${session.status}. Will keep stream open for 5 more seconds to send remaining events.`);
        }

        // Calculate time elapsed since session ended
        const elapsedSeconds = sessionEndedTime
          ? (new Date().getTime() - sessionEndedTime.getTime()) / 1000
          : 0;

        // After 5 seconds, send final session_ended event and close
        if (elapsedSeconds >= 5) {
          if (!finalEventsSent) {
            sendEvent({
              type: 'session_ended',
              payload: {
                status: session.status,
                message: 'All events have been sent. Closing stream.'
              },
              timestamp: new Date(),
            });
            finalEventsSent = true;
            console.log(`[SSE] Sending final session_ended event for session ${sessionId}`);
          }

          // Give a small additional delay to ensure the final event is sent
          setTimeout(() => {
            clearInterval(pollInterval);
            res.end();
            console.log(`[SSE] Stream closed for session ${sessionId}`);
          }, 500);
        } else {
          // Continue polling for events during the grace period
          console.log(`[SSE] Session ${sessionId} completed. Continuing to poll for events (${Math.ceil(5 - elapsedSeconds)}s remaining)...`);
        }
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
