import { Request, Response, NextFunction } from 'express';
import path from 'path';

/**
 * Validates that a file path is safe and doesn't contain path traversal attempts
 */
export function validateFilePath(filePath: string, baseDir: string): boolean {
  try {
    const resolved = path.resolve(baseDir, filePath);
    const base = path.resolve(baseDir);
    return resolved.startsWith(base);
  } catch {
    return false;
  }
}

/**
 * Middleware to validate project base path
 */
export function validateProjectPath(req: Request, res: Response, next: NextFunction) {
  const { base_path } = req.body;
  
  if (base_path) {
    // Prevent path traversal
    if (base_path.includes('..')) {
      return res.status(400).json({ error: 'Invalid base_path: path traversal detected' });
    }
    
    // Must be absolute path
    if (!path.isAbsolute(base_path)) {
      return res.status(400).json({ error: 'Invalid base_path: must be an absolute path' });
    }
    
    // Additional security: prevent access to system directories
    const normalizedPath = path.normalize(base_path);
    const forbiddenPaths = ['/etc', '/usr', '/bin', '/sbin', '/var', '/sys', '/proc', '/dev'];
    const isForbidden = forbiddenPaths.some(forbidden => normalizedPath.startsWith(forbidden));
    
    if (isForbidden) {
      return res.status(400).json({ error: 'Invalid base_path: cannot use system directories' });
    }
    
    // Optional workspace restriction - only if WORKSPACE_ROOT is explicitly set
    const workspaceRoot = process.env.WORKSPACE_ROOT;
    if (workspaceRoot) {
      if (!validateFilePath(base_path, workspaceRoot)) {
        return res.status(400).json({ error: 'Invalid base_path: path outside configured workspace' });
      }
    }
  }
  
  next();
}

/**
 * Sanitize string input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .trim();
}

