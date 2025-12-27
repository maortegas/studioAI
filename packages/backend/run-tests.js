#!/usr/bin/env node

/**
 * Alternative test runner for Jest in monorepo
 * This script runs Jest with proper module resolution
 */

const path = require('path');
const { spawn } = require('child_process');

// Add workspace root node_modules to NODE_PATH
const workspaceRoot = path.resolve(__dirname, '../..');
const backendPath = __dirname;

process.env.NODE_PATH = `${workspaceRoot}/node_modules:${process.env.NODE_PATH || ''}`;

// Run Jest
const jestPath = path.join(workspaceRoot, 'node_modules', '.bin', 'jest');
const jestProcess = spawn('node', [jestPath], {
  cwd: backendPath,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_PATH: process.env.NODE_PATH
  }
});

jestProcess.on('exit', (code) => {
  process.exit(code || 0);
});



