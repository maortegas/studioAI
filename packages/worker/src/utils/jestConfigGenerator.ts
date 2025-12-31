import fs from 'fs/promises';
import path from 'path';

/**
 * Generates Jest configuration files for ES6 module support
 */
export class JestConfigGenerator {
  /**
   * Creates jest.config.js with ES6 module support
   */
  static generateJestConfig(): string {
    return `export default {
  testEnvironment: 'node',

  // Module name mapper for clean imports
  moduleNameMapper: {
    '^(\\\\.{1,2}/.*)\\\\.js$': '$1',
  },

  // Transform configuration
  transform: {
    // Use default Jest transformer for .js files
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
  ],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};
`;
  }

  /**
   * Creates babel.config.json for Jest transformation
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
  static async hasJestDependencies(projectPath: string): Promise<{ hasJest: boolean; hasBabel: boolean }> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      const devDeps = packageJson.devDependencies || {};
      const hasJest = 'jest' in devDeps;
      const hasBabel = '@babel/core' in devDeps && '@babel/preset-env' in devDeps && 'babel-jest' in devDeps;

      return { hasJest, hasBabel };
    } catch (error) {
      return { hasJest: false, hasBabel: false };
    }
  }

  /**
   * Adds Babel dependencies to package.json
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
   * Creates jest.config.js, babel.config.json, and adds dependencies
   */
  static async autoConfigureJest(projectPath: string): Promise<{ configured: boolean; reason: string }> {
    console.log(`[JestConfigGenerator] Checking if project needs Jest ES6 configuration: ${projectPath}`);

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
    const { hasJest, hasBabel } = await this.hasJestDependencies(projectPath);

    if (!hasJest) {
      console.log(`[JestConfigGenerator] ⚠️ No Jest dependency found in package.json`);
      return { configured: false, reason: 'No Jest dependency in package.json' };
    }

    console.log(`[JestConfigGenerator] Creating Jest configuration files...`);

    // Create jest.config.js
    const jestConfig = this.generateJestConfig();
    await fs.writeFile(jestConfigPath, jestConfig, 'utf-8');
    console.log(`[JestConfigGenerator] ✅ Created jest.config.js`);

    // Create babel.config.json
    const babelConfigPath = path.join(projectPath, 'babel.config.json');
    const babelConfig = this.generateBabelConfig();
    await fs.writeFile(babelConfigPath, babelConfig, 'utf-8');
    console.log(`[JestConfigGenerator] ✅ Created babel.config.json`);

    // Add Babel dependencies if not present
    if (!hasBabel) {
      await this.addBabelDependencies(projectPath);
      console.log(`[JestConfigGenerator] ✅ Added Babel dependencies to package.json`);
      console.log(`[JestConfigGenerator] ⚠️ Run 'npm install' to install new dependencies`);
    }

    return { configured: true, reason: 'Jest configured for ES6 modules' };
  }
}
