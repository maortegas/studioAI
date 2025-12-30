import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileTreeOptions {
  maxDepth?: number;
  excludeDirs?: string[];
  onlyShowExisting?: boolean;
}

/**
 * Scan project structure and generate a tree representation
 * Used to show AI the current file structure in prompts
 */
export async function scanProjectStructure(
  basePath: string,
  options: FileTreeOptions = {}
): Promise<string> {
  const {
    maxDepth = 3,
    excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.agentdb', '.tdd-checkpoints']
  } = options;

  const tree: string[] = [];
  tree.push(path.basename(basePath) + '/');

  async function scan(dir: string, depth: number, prefix: string = ''): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Filter out excluded directories
      const filteredEntries = entries.filter(
        entry => !excludeDirs.includes(entry.name)
      );

      // Sort: directories first, then files
      filteredEntries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < filteredEntries.length; i++) {
        const entry = filteredEntries[i];
        const isLast = i === filteredEntries.length - 1;
        const connector = isLast ? '└──' : '├──';
        const line = `${prefix}${connector} ${entry.name}${entry.isDirectory() ? '/' : ''}`;

        tree.push(line);

        if (entry.isDirectory()) {
          const newPrefix = prefix + (isLast ? '    ' : '│   ');
          await scan(path.join(dir, entry.name), depth + 1, newPrefix);
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.warn(`[FileTree] Cannot read directory: ${dir}`);
    }
  }

  await scan(basePath, 0);

  return tree.join('\n');
}

/**
 * Generate a compact file tree (only directories, no files)
 * Useful when full tree is too large
 */
export async function scanProjectStructureCompact(
  basePath: string,
  options: FileTreeOptions = {}
): Promise<string> {
  const {
    maxDepth = 4,
    excludeDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.agentdb', '.tdd-checkpoints']
  } = options;

  const tree: string[] = [];
  tree.push(path.basename(basePath) + '/');

  async function scan(dir: string, depth: number, prefix: string = ''): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Only directories
      const directories = entries.filter(
        entry => entry.isDirectory() && !excludeDirs.includes(entry.name)
      );

      directories.sort((a, b) => a.name.localeCompare(b.name));

      for (let i = 0; i < directories.length; i++) {
        const entry = directories[i];
        const isLast = i === directories.length - 1;
        const connector = isLast ? '└──' : '├──';
        const line = `${prefix}${connector} ${entry.name}/`;

        tree.push(line);

        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        await scan(path.join(dir, entry.name), depth + 1, newPrefix);
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await scan(basePath, 0);

  return tree.join('\n');
}

/**
 * Check if a file tree is too large for prompt
 * Returns true if should use compact version
 */
export function shouldUseCompactTree(tree: string): boolean {
  const lineCount = tree.split('\n').length;
  const charCount = tree.length;

  // Use compact if more than 100 lines or 5000 characters
  return lineCount > 100 || charCount > 5000;
}
