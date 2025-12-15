import { Request, Response, NextFunction } from 'express';

/**
 * Audit logging middleware
 */
export function auditLog(req: Request, res: Response, next: NextFunction) {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.socket.remoteAddress;

  // Log important operations
  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    console.log(`[AUDIT] ${timestamp} - ${method} ${path} - IP: ${ip}`);
  }

  next();
}

