import * as fs from 'fs/promises';
import * as path from 'path';
import { MissingImport } from './importValidator';

export interface ScaffoldResult {
  filePath: string;
  created: boolean;
  error?: string;
  imports?: string[];
}

/**
 * Create scaffold (stub) files for missing imports
 * This allows Jest to load test files even when implementation doesn't exist yet
 */
export async function createScaffoldsForMissingImports(
  missingImports: MissingImport[],
  projectPath: string
): Promise<ScaffoldResult[]> {
  const results: ScaffoldResult[] = [];

  // Only scaffold local imports (not npm packages)
  const localImports = missingImports.filter(imp => imp.canScaffold);

  for (const imp of localImports) {
    try {
      const result = await createScaffold(imp, projectPath);
      results.push(result);
    } catch (error: any) {
      results.push({
        filePath: imp.resolvedPath,
        created: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Create a single scaffold file with empty exports
 */
async function createScaffold(
  missingImport: MissingImport,
  projectPath: string
): Promise<ScaffoldResult> {
  const filePath = missingImport.resolvedPath;

  // Check if file already exists
  try {
    await fs.access(filePath);
    return {
      filePath,
      created: false,
      error: 'File already exists'
    };
  } catch {
    // File doesn't exist, proceed with creation
  }

  // Create directory if it doesn't exist
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Extract imported names from import statement
  const importedNames = extractImportedNames(missingImport.importStatement);

  // Generate stub content based on file extension
  const ext = path.extname(filePath);
  const content = generateStubContent(importedNames, ext);

  // Write stub file
  await fs.writeFile(filePath, content, 'utf-8');

  console.log(`[Scaffolder] Created scaffold: ${filePath}`);
  console.log(`[Scaffolder] Exported: ${importedNames.join(', ')}`);

  return {
    filePath,
    created: true,
    imports: importedNames
  };
}

/**
 * Extract imported names from import statement
 * Examples:
 *   "import { Foo, Bar } from './module'" -> ['Foo', 'Bar']
 *   "import * as Foo from './module'" -> ['Foo']
 *   "import Foo from './module'" -> ['Foo']
 */
function extractImportedNames(importStatement: string): string[] {
  const names: string[] = [];

  // Pattern 1: Named imports - import { Foo, Bar, Baz } from '...'
  const namedMatch = importStatement.match(/import\s+{([^}]+)}/);
  if (namedMatch) {
    const namedImports = namedMatch[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    names.push(...namedImports);
  }

  // Pattern 2: Namespace import - import * as Foo from '...'
  const namespaceMatch = importStatement.match(/import\s+\*\s+as\s+(\w+)/);
  if (namespaceMatch) {
    names.push(namespaceMatch[1]);
  }

  // Pattern 3: Default import - import Foo from '...'
  const defaultMatch = importStatement.match(/import\s+(\w+)\s+from/);
  if (defaultMatch && !namespaceMatch) {
    // Only add if not already captured by namespace
    const defaultName = defaultMatch[1];
    if (!names.includes(defaultName)) {
      names.push(defaultName);
    }
  }

  return names;
}

/**
 * Generate stub content with empty exports
 */
function generateStubContent(importedNames: string[], fileExtension: string): string {
  const isTypeScript = fileExtension === '.ts' || fileExtension === '.tsx';

  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * AUTO-GENERATED SCAFFOLD FILE');
  lines.push(' * This file was created automatically by the TDD system.');
  lines.push(' * Replace this stub with your actual implementation.');
  lines.push(' */');
  lines.push('');

  if (importedNames.length === 0) {
    // No specific imports, just export empty object
    lines.push('export {};');
    lines.push('');
  } else {
    // Export each imported name as a stub
    for (const name of importedNames) {
      // Detect if it's a class, interface, or function based on naming convention
      if (name[0] === name[0].toUpperCase()) {
        // PascalCase -> likely a class or interface
        if (isTypeScript) {
          lines.push(`export class ${name} {`);
          lines.push(`  // TODO: Implement ${name}`);
          lines.push(`}`);
        } else {
          lines.push(`export class ${name} {`);
          lines.push(`  // TODO: Implement ${name}`);
          lines.push(`}`);
        }
      } else {
        // camelCase -> likely a function or constant
        if (isTypeScript) {
          lines.push(`export function ${name}(): void {`);
          lines.push(`  // TODO: Implement ${name}`);
          lines.push(`  throw new Error('Not implemented: ${name}');`);
          lines.push(`}`);
        } else {
          lines.push(`export function ${name}() {`);
          lines.push(`  // TODO: Implement ${name}`);
          lines.push(`  throw new Error('Not implemented: ${name}');`);
          lines.push(`}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Clean up scaffolds created for a specific test file
 * Use this if test generation is retried or cancelled
 */
export async function cleanupScaffolds(scaffoldResults: ScaffoldResult[]): Promise<void> {
  for (const result of scaffoldResults) {
    if (result.created) {
      try {
        await fs.unlink(result.filePath);
        console.log(`[Scaffolder] Removed scaffold: ${result.filePath}`);
      } catch (error) {
        console.warn(`[Scaffolder] Could not remove scaffold: ${result.filePath}`);
      }
    }
  }
}
