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
    // Directory exists, verify it's actually a directory
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Directory doesn't exist, create it recursively
      await fs.mkdir(dirPath, { recursive: true });
    } else {
      throw error;
    }
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

