import fs from 'fs/promises';
import path from 'path';

/**
 * Validates that a path is safe and doesn't contain path traversal attempts
 */
export function validatePath(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(baseDir, filePath);
  const base = path.resolve(baseDir);
  return resolved.startsWith(base);
}

/**
 * Creates a directory if it doesn't exist
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Creates a file with content
 */
export async function createFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDirectory(dir);
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Reads a file
 */
export async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf8');
}

/**
 * Checks if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

