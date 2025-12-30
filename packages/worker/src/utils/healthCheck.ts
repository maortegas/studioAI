import * as fs from 'fs/promises';
import * as path from 'path';

export interface HealthCheckResult {
  healthy: boolean;
  checks: {
    name: string;
    passed: boolean;
    message: string;
    severity: 'critical' | 'warning' | 'info';
  }[];
  canProceed: boolean;
  warnings: string[];
  criticalIssues: string[];
}

/**
 * Comprehensive health check before test execution
 * Validates environment, dependencies, and project structure
 */
export async function performPreTestHealthCheck(
  projectPath: string,
  testFilePath: string
): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = [];
  const warnings: string[] = [];
  const criticalIssues: string[] = [];

  // Check 1: Test file exists
  try {
    await fs.access(testFilePath);
    checks.push({
      name: 'Test File Exists',
      passed: true,
      message: `Test file found: ${path.basename(testFilePath)}`,
      severity: 'info'
    });
  } catch {
    checks.push({
      name: 'Test File Exists',
      passed: false,
      message: `Test file not found: ${testFilePath}`,
      severity: 'critical'
    });
    criticalIssues.push('Test file does not exist');
  }

  // Check 2: package.json exists
  const packageJsonPath = path.join(projectPath, 'package.json');
  let hasPackageJson = false;
  try {
    await fs.access(packageJsonPath);
    hasPackageJson = true;
    checks.push({
      name: 'package.json',
      passed: true,
      message: 'package.json found',
      severity: 'info'
    });
  } catch {
    checks.push({
      name: 'package.json',
      passed: false,
      message: 'package.json not found',
      severity: 'critical'
    });
    criticalIssues.push('package.json missing');
  }

  // Check 3: Jest configuration
  if (hasPackageJson) {
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const hasJest =
        packageJson.devDependencies?.jest ||
        packageJson.dependencies?.jest ||
        packageJson.scripts?.test;

      if (hasJest) {
        checks.push({
          name: 'Jest Configuration',
          passed: true,
          message: 'Jest detected in package.json',
          severity: 'info'
        });
      } else {
        checks.push({
          name: 'Jest Configuration',
          passed: false,
          message: 'Jest not found in package.json',
          severity: 'warning'
        });
        warnings.push('Jest not configured - tests may not run');
      }
    } catch (error: any) {
      checks.push({
        name: 'Jest Configuration',
        passed: false,
        message: `Error reading package.json: ${error.message}`,
        severity: 'warning'
      });
    }
  }

  // Check 4: node_modules exists
  const nodeModulesPath = path.join(projectPath, 'node_modules');
  try {
    await fs.access(nodeModulesPath);
    checks.push({
      name: 'Dependencies Installed',
      passed: true,
      message: 'node_modules directory exists',
      severity: 'info'
    });
  } catch {
    checks.push({
      name: 'Dependencies Installed',
      passed: false,
      message: 'node_modules not found - run npm install',
      severity: 'critical'
    });
    criticalIssues.push('Dependencies not installed');
  }

  // Check 5: Jest config file
  const jestConfigPaths = [
    path.join(projectPath, 'jest.config.js'),
    path.join(projectPath, 'jest.config.cjs'),
    path.join(projectPath, 'jest.config.ts'),
    path.join(projectPath, 'jest.config.json')
  ];

  let jestConfigFound = false;
  for (const configPath of jestConfigPaths) {
    try {
      await fs.access(configPath);
      jestConfigFound = true;
      checks.push({
        name: 'Jest Config File',
        passed: true,
        message: `Found: ${path.basename(configPath)}`,
        severity: 'info'
      });
      break;
    } catch {
      continue;
    }
  }

  if (!jestConfigFound && hasPackageJson) {
    checks.push({
      name: 'Jest Config File',
      passed: false,
      message: 'No jest.config file found (may use package.json config)',
      severity: 'warning'
    });
    warnings.push('No dedicated jest.config file - using package.json config');
  }

  // Check 6: TypeScript configuration (if .ts test file)
  if (testFilePath.endsWith('.ts') || testFilePath.endsWith('.tsx')) {
    const tsconfigPath = path.join(projectPath, 'tsconfig.json');
    try {
      await fs.access(tsconfigPath);
      checks.push({
        name: 'TypeScript Config',
        passed: true,
        message: 'tsconfig.json found',
        severity: 'info'
      });
    } catch {
      checks.push({
        name: 'TypeScript Config',
        passed: false,
        message: 'tsconfig.json not found for TypeScript test',
        severity: 'warning'
      });
      warnings.push('No tsconfig.json for TypeScript tests');
    }
  }

  // Determine overall health
  const healthy = criticalIssues.length === 0;
  const canProceed = criticalIssues.length === 0;

  return {
    healthy,
    checks,
    canProceed,
    warnings,
    criticalIssues
  };
}

/**
 * Format health check results for logging
 */
export function formatHealthCheckReport(result: HealthCheckResult): string {
  const lines: string[] = [];

  lines.push('=== Pre-Test Health Check ===');
  lines.push(`Overall Status: ${result.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
  lines.push('');

  // Group checks by severity
  const critical = result.checks.filter(c => c.severity === 'critical' && !c.passed);
  const warning = result.checks.filter(c => c.severity === 'warning' && !c.passed);
  const passed = result.checks.filter(c => c.passed);

  if (critical.length > 0) {
    lines.push('🚨 CRITICAL ISSUES:');
    critical.forEach(check => {
      lines.push(`  ❌ ${check.name}: ${check.message}`);
    });
    lines.push('');
  }

  if (warning.length > 0) {
    lines.push('⚠️  WARNINGS:');
    warning.forEach(check => {
      lines.push(`  ⚠️  ${check.name}: ${check.message}`);
    });
    lines.push('');
  }

  if (passed.length > 0) {
    lines.push('✅ PASSED CHECKS:');
    passed.forEach(check => {
      lines.push(`  ✓ ${check.name}`);
    });
    lines.push('');
  }

  if (!result.canProceed) {
    lines.push('❌ Cannot proceed with test execution due to critical issues');
  } else if (result.warnings.length > 0) {
    lines.push('✅ Can proceed with warnings');
  } else {
    lines.push('✅ All checks passed - ready for test execution');
  }

  return lines.join('\n');
}
