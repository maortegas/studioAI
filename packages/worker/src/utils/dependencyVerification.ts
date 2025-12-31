import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export interface VerificationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  actions: string[];
}

/**
 * Dependency Verification Service
 * Pre-verifies project dependencies before running TDD tests
 */
export class DependencyVerificationService {
  /**
   * Verify all dependencies for a project
   */
  static async verifyProjectDependencies(projectPath: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      success: true,
      errors: [],
      warnings: [],
      actions: [],
    };

    console.log(`[DependencyVerification] Verifying dependencies for: ${projectPath}`);

    // 1. Verify Prisma
    await this.verifyPrisma(projectPath, result);

    // 2. Verify package.json exists
    await this.verifyPackageJson(projectPath, result);

    // 3. Verify node_modules exists
    await this.verifyNodeModules(projectPath, result);

    if (result.errors.length > 0) {
      result.success = false;
    }

    return result;
  }

  /**
   * Verify Prisma setup and generate client if needed
   */
  private static async verifyPrisma(projectPath: string, result: VerificationResult): Promise<void> {
    const schemaPath = path.join(projectPath, 'prisma', 'schema.prisma');

    try {
      await fs.access(schemaPath);
      console.log(`[DependencyVerification] Prisma schema found at: ${schemaPath}`);

      // Validate schema syntax
      const isValid = await this.validatePrismaSchema(projectPath);
      if (!isValid) {
        result.errors.push('Prisma schema validation failed');
        return;
      }

      // Check if @prisma/client is generated
      const prismaClientPath = path.join(projectPath, 'node_modules', '@prisma', 'client');
      try {
        await fs.access(prismaClientPath);
        console.log(`[DependencyVerification] ✅ Prisma client already generated`);
      } catch {
        // Prisma client not generated, generate it
        console.log(`[DependencyVerification] Prisma client not found, generating...`);
        const generated = await this.generatePrismaClient(projectPath);
        if (generated) {
          result.actions.push('Generated Prisma client');
          console.log(`[DependencyVerification] ✅ Prisma client generated successfully`);
        } else {
          result.errors.push('Failed to generate Prisma client');
        }
      }
    } catch {
      // No Prisma schema, skip
      console.log(`[DependencyVerification] No Prisma schema found, skipping Prisma verification`);
    }
  }

  /**
   * Validate Prisma schema syntax
   */
  private static async validatePrismaSchema(projectPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('npx', ['prisma', 'validate'], {
        cwd: projectPath,
        stdio: 'pipe',
      });

      let stderr = '';

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[DependencyVerification] ✅ Prisma schema is valid`);
          resolve(true);
        } else {
          console.error(`[DependencyVerification] ❌ Prisma schema validation failed:\n${stderr}`);
          resolve(false);
        }
      });

      child.on('error', (error) => {
        console.error(`[DependencyVerification] Error validating Prisma schema: ${error.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Generate Prisma client
   */
  private static async generatePrismaClient(projectPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('npx', ['prisma', 'generate'], {
        cwd: projectPath,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          console.error(`[DependencyVerification] Failed to generate Prisma client:\n${stderr}`);
          resolve(false);
        }
      });

      child.on('error', (error) => {
        console.error(`[DependencyVerification] Error generating Prisma client: ${error.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Verify package.json exists
   */
  private static async verifyPackageJson(projectPath: string, result: VerificationResult): Promise<void> {
    const packageJsonPath = path.join(projectPath, 'package.json');

    try {
      await fs.access(packageJsonPath);
      console.log(`[DependencyVerification] ✅ package.json found`);
    } catch {
      result.errors.push('package.json not found');
      console.error(`[DependencyVerification] ❌ package.json not found`);
    }
  }

  /**
   * Verify node_modules exists
   */
  private static async verifyNodeModules(projectPath: string, result: VerificationResult): Promise<void> {
    const nodeModulesPath = path.join(projectPath, 'node_modules');

    try {
      await fs.access(nodeModulesPath);
      console.log(`[DependencyVerification] ✅ node_modules found`);
    } catch {
      result.warnings.push('node_modules not found - dependencies may not be installed');
      console.warn(`[DependencyVerification] ⚠️ node_modules not found - run npm install first`);
    }
  }

  /**
   * Detect infrastructure errors in test output
   */
  static detectInfrastructureError(errorOutput: string): {
    isInfrastructure: boolean;
    type?: 'prisma' | 'dependencies' | 'typescript' | 'jest' | 'imports';
    suggestion?: string;
  } {
    // Prisma errors
    if (errorOutput.includes('@prisma/client did not initialize') ||
        errorOutput.includes('prisma generate') ||
        errorOutput.includes('Prisma schema validation')) {
      return {
        isInfrastructure: true,
        type: 'prisma',
        suggestion: 'Run dependency verification and prisma generate',
      };
    }

    // Missing dependencies
    if (errorOutput.includes('Cannot find module') ||
        errorOutput.includes('MODULE_NOT_FOUND')) {
      return {
        isInfrastructure: true,
        type: 'dependencies',
        suggestion: 'Run npm install to install missing dependencies',
      };
    }

    // TypeScript compilation errors
    if (errorOutput.includes('TS') && errorOutput.includes('error TS')) {
      return {
        isInfrastructure: true,
        type: 'typescript',
        suggestion: 'Fix TypeScript compilation errors',
      };
    }

    // Jest configuration errors
    if (errorOutput.includes('Multiple configurations found') ||
        errorOutput.includes('jest.config')) {
      return {
        isInfrastructure: true,
        type: 'jest',
        suggestion: 'Remove duplicate Jest configuration files',
      };
    }

    // Import hoisting errors
    if (errorOutput.includes('Cannot access') && errorOutput.includes('before initialization')) {
      return {
        isInfrastructure: true,
        type: 'imports',
        suggestion: 'Fix Jest mock hoisting - move jest.mock() calls before imports',
      };
    }

    return { isInfrastructure: false };
  }
}
