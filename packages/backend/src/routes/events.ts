import { Router, Request, Response } from 'express';
import { AIJobRepository } from '../repositories/aiJobRepository';

const router = Router();
const aiJobRepo = new AIJobRepository();

// Store active SSE connections
const connections = new Map<string, Response>();

router.get('/stream', (req: Request, res: Response) => {
  const clientId = req.query.clientId as string || `client-${Date.now()}`;
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  connections.set(clientId, res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    connections.delete(clientId);
    res.end();
  });
});

// Helper function to broadcast events to all connected clients
export function broadcastEvent(event: { type: string; data: any }) {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  connections.forEach((res) => {
    try {
      res.write(message);
    } catch (error) {
      // Client disconnected, will be cleaned up on next close event
    }
  });
}

export default router;

