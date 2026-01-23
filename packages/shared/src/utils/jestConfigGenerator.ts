import fs from 'fs/promises';
import path from 'path';

/**
 * Generates Jest configuration files with TypeScript or JavaScript support
 */
export class JestConfigGenerator {
  /**
   * Creates jest.config.js for TypeScript projects with ts-jest
   */
  static generateTypeScriptJestConfig(): string {
    return `export default {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Module name mapper for clean imports
  moduleNameMapper: {
    '^(\\\\.{1,2}/.*)\\\\.js$': '$1',
  },

  // Transform configuration for TypeScript
  transform: {
    '^.+\\\\.tsx?$': ['ts-jest', {
      useESM: true,
    }],
  },

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.test.tsx',
    '**/tests/**/*.spec.ts',
    '**/__tests__/**/*.ts',
    '**/__tests__/**/*.tsx',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    '/.tdd-checkpoints/',
  ],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,

  // ES modules support
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
};
`;
  }

  /**
   * Creates jest.config.js for JavaScript projects with babel-jest
   */
  static generateJavaScriptJestConfig(): string {
    return `export default {
  testEnvironment: 'node',

  // Module name mapper for clean imports
  moduleNameMapper: {
    '^(\\\\.{1,2}/.*)\\\\.js$': '$1',
  },

  // Transform configuration
  transform: {
    // Use babel-jest for .js files
    '^.+\\\\.js$': ['babel-jest', { configFile: './babel.config.json' }],
  },

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js',
    '**/__tests__/**/*.js',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    '/.tdd-checkpoints/',
  ],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};
`;
  }

  /**
   * Creates babel.config.json for JavaScript projects
   */
  static generateBabelConfig(): string {
    return `{
  "presets": [
    [
      "@babel/preset-env",
      {
        "targets": {
          "node": "current"
        }
      }
    ]
  ]
}
`;
  }

  /**
   * Checks if project uses TypeScript
   */
  static async isTypeScriptProject(projectPath: string): Promise<boolean> {
    try {
      // Check 1: Look for tsconfig.json
      const tsconfigPath = path.join(projectPath, 'tsconfig.json');
      try {
        await fs.access(tsconfigPath);
        return true;
      } catch {
        // tsconfig.json doesn't exist, check package.json
      }

      // Check 2: Look for typescript in dependencies
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const deps = packageJson.dependencies || {};
      const devDeps = packageJson.devDependencies || {};

      return 'typescript' in deps || 'typescript' in devDeps;
    } catch (error) {
      return false;
    }
  }

  /**
   * Checks if package.json has "type": "module"
   */
  static async isESModuleProject(projectPath: string): Promise<boolean> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      return packageJson.type === 'module';
    } catch (error) {
      return false;
    }
  }

  /**
   * Checks if Jest dependencies are present in package.json
   */
  static async hasJestDependencies(projectPath: string): Promise<{
    hasJest: boolean;
    hasTsJest: boolean;
    hasBabel: boolean
  }> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const devDeps = packageJson.devDependencies || {};
      const hasJest = 'jest' in devDeps;
      const hasTsJest = 'ts-jest' in devDeps;
      const hasBabel = '@babel/core' in devDeps && '@babel/preset-env' in devDeps && 'babel-jest' in devDeps;

      return { hasJest, hasTsJest, hasBabel };
    } catch (error) {
      return { hasJest: false, hasTsJest: false, hasBabel: false };
    }
  }

  /**
   * Adds TypeScript Jest dependencies to package.json
   */
  static async addTypeScriptJestDependencies(projectPath: string): Promise<void> {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
    }

    // Add ts-jest and @types/jest if not present
    if (!packageJson.devDependencies['ts-jest']) {
      packageJson.devDependencies['ts-jest'] = '^29.1.1';
    }
    if (!packageJson.devDependencies['@types/jest']) {
      packageJson.devDependencies['@types/jest'] = '^29.5.11';
    }

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  }

  /**
   * Adds JavaScript Babel dependencies to package.json
   */
  static async addBabelDependencies(projectPath: string): Promise<void> {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
    }

    // Add Babel dependencies if not present
    if (!packageJson.devDependencies['@babel/core']) {
      packageJson.devDependencies['@babel/core'] = '^7.23.0';
    }
    if (!packageJson.devDependencies['@babel/preset-env']) {
      packageJson.devDependencies['@babel/preset-env'] = '^7.23.0';
    }
    if (!packageJson.devDependencies['babel-jest']) {
      packageJson.devDependencies['babel-jest'] = '^29.7.0';
    }

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  }

  /**
   * Auto-configures Jest for ES6 modules in a project
   * Detects TypeScript and configures accordingly
   */
  static async autoConfigureJest(projectPath: string): Promise<{ configured: boolean; reason: string }> {
    console.log(`[JestConfigGenerator] Checking if project needs Jest configuration: ${projectPath}`);

    // Check if it's an ES module project
    const isESModule = await this.isESModuleProject(projectPath);
    if (!isESModule) {
      return { configured: false, reason: 'Not an ES module project (no "type": "module")' };
    }

    console.log(`[JestConfigGenerator] ✅ Project uses ES modules`);

    // Check if Jest config already exists
    const jestConfigPath = path.join(projectPath, 'jest.config.js');
    try {
      await fs.access(jestConfigPath);
      console.log(`[JestConfigGenerator] Jest config already exists, skipping`);
      return { configured: false, reason: 'jest.config.js already exists' };
    } catch {
      // File doesn't exist, continue
    }

    // Check dependencies
    const { hasJest, hasTsJest, hasBabel } = await this.hasJestDependencies(projectPath);

    if (!hasJest) {
      console.log(`[JestConfigGenerator] ⚠️ No Jest dependency found in package.json`);
      return { configured: false, reason: 'No Jest dependency in package.json' };
    }

    // Detect if TypeScript project
    const isTypeScript = await this.isTypeScriptProject(projectPath);

    if (isTypeScript) {
      console.log(`[JestConfigGenerator] 🔷 Detected TypeScript project, configuring ts-jest...`);

      // Create TypeScript jest.config.js
      const jestConfig = this.generateTypeScriptJestConfig();
      await fs.writeFile(jestConfigPath, jestConfig, 'utf-8');
      console.log(`[JestConfigGenerator] ✅ Created jest.config.js for TypeScript`);

      // Add ts-jest dependencies if not present
      if (!hasTsJest) {
        await this.addTypeScriptJestDependencies(projectPath);
        console.log(`[JestConfigGenerator] ✅ Added TypeScript Jest dependencies to package.json`);
      }

      return { configured: true, reason: 'Jest configured for TypeScript with ts-jest' };
    } else {
      console.log(`[JestConfigGenerator] 📦 Detected JavaScript project, configuring babel-jest...`);

      // Create JavaScript jest.config.js
      const jestConfig = this.generateJavaScriptJestConfig();
      await fs.writeFile(jestConfigPath, jestConfig, 'utf-8');
      console.log(`[JestConfigGenerator] ✅ Created jest.config.js for JavaScript`);

      // Create babel.config.json
      const babelConfigPath = path.join(projectPath, 'babel.config.json');
      const babelConfig = this.generateBabelConfig();
      await fs.writeFile(babelConfigPath, babelConfig, 'utf-8');
      console.log(`[JestConfigGenerator] ✅ Created babel.config.json`);

      // Add Babel dependencies if not present
      if (!hasBabel) {
        await this.addBabelDependencies(projectPath);
        console.log(`[JestConfigGenerator] ✅ Added Babel dependencies to package.json`);
      }

      return { configured: true, reason: 'Jest configured for JavaScript with babel-jest' };
    }
  }
}
