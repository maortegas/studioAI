import * as fs from 'fs/promises';
import * as path from 'path';

export interface ImportInfo {
  raw: string;
  modulePath: string;
  isLocal: boolean;
  importedNames?: string[];
}

export interface MissingImport {
  importStatement: string;
  modulePath: string;
  resolvedPath: string;
  canScaffold: boolean;
}

export interface ImportValidationResult {
  valid: boolean;
  totalImports: number;
  existingImports: number;
  missingImports: MissingImport[];
  canAutoFix: boolean;
}

/**
 * Extract all import statements from TypeScript/JavaScript code
 */
export function extractImports(code: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Pattern 1: import { Foo, Bar } from 'module'
  const importRegex = /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const namedImports = match[1];
    const namespaceImport = match[2];
    const defaultImport = match[3];
    const modulePath = match[4];

    const importedNames: string[] = [];
    if (namedImports) {
      importedNames.push(...namedImports.split(',').map(s => s.trim()));
    }
    if (namespaceImport) {
      importedNames.push(namespaceImport);
    }
    if (defaultImport) {
      importedNames.push(defaultImport);
    }

    imports.push({
      raw: match[0],
      modulePath,
      isLocal: modulePath.startsWith('./') || modulePath.startsWith('../'),
      importedNames
    });
  }

  // Pattern 2: require('module')
  const requireRegex = /(?:const|let|var)\s+(?:{([^}]+)}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g;

  while ((match = requireRegex.exec(code)) !== null) {
    const namedImports = match[1];
    const defaultImport = match[2];
    const modulePath = match[3];

    const importedNames: string[] = [];
    if (namedImports) {
      importedNames.push(...namedImports.split(',').map(s => s.trim()));
    }
    if (defaultImport) {
      importedNames.push(defaultImport);
    }

    imports.push({
      raw: match[0],
      modulePath,
      isLocal: modulePath.startsWith('./') || modulePath.startsWith('../'),
      importedNames
    });
  }

  return imports;
}

/**
 * Resolve import path to absolute file system path
 */
export function resolveImportPath(
  imp: ImportInfo,
  testFilePath: string,
  projectPath: string
): string {
  if (!imp.isLocal) {
    // NPM package - check node_modules
    return path.join(projectPath, 'node_modules', imp.modulePath);
  }

  // Resolve relative to test file
  const testDir = path.dirname(testFilePath);
  let resolved = path.resolve(testDir, imp.modulePath);

  // Try adding extensions if no extension present
  if (!path.extname(resolved)) {
    // Common extensions to try
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      // We'll check existence in validateTestImports
      // For now, just return the .ts version as default
      if (ext === '.ts' || ext === '.tsx') {
        return withExt;
      }
    }
    // Default to .ts
    return resolved + '.ts';
  }

  return resolved;
}

/**
 * Check if a file exists, trying multiple extensions
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    // If no extension, try with extensions
    if (!path.extname(filePath)) {
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];
      for (const ext of extensions) {
        try {
          await fs.access(filePath + ext);
          return true;
        } catch {
          continue;
        }
      }
    }
    return false;
  }
}

/**
 * Validate all imports in a test file
 * Returns list of missing imports that need to be scaffolded
 */
export async function validateTestImports(
  testFilePath: string,
  projectPath: string
): Promise<ImportValidationResult> {
  // Read test file
  const content = await fs.readFile(testFilePath, 'utf-8');

  // Extract all imports
  const imports = extractImports(content);

  const missing: MissingImport[] = [];
  let existingCount = 0;

  for (const imp of imports) {
    const resolvedPath = resolveImportPath(imp, testFilePath, projectPath);

    // Check if file exists
    const exists = await fileExists(resolvedPath);

    if (exists) {
      existingCount++;
    } else {
      // NPM packages: check if directory exists in node_modules
      if (!imp.isLocal) {
        const nodeModulesPath = path.join(projectPath, 'node_modules', imp.modulePath.split('/')[0]);
        const npmExists = await fileExists(nodeModulesPath);

        if (!npmExists) {
          missing.push({
            importStatement: imp.raw,
            modulePath: imp.modulePath,
            resolvedPath,
            canScaffold: false // NPM packages can't be scaffolded
          });
        } else {
          existingCount++;
        }
      } else {
        // Local import missing
        missing.push({
          importStatement: imp.raw,
          modulePath: imp.modulePath,
          resolvedPath,
          canScaffold: true // Local files can be scaffolded
        });
      }
    }
  }

  return {
    valid: missing.length === 0,
    totalImports: imports.length,
    existingImports: existingCount,
    missingImports: missing,
    canAutoFix: missing.every(m => m.canScaffold)
  };
}
