import 'dotenv/config';
import { Pool } from 'pg';
import { CursorCLI } from './cli/cursor';
import { ClaudeCLI } from './cli/claude';
import { AIProvider, AIMode, AIJobStatus } from '@devflow-studio/shared';
import path from 'path';
import fs from 'fs/promises';
import { validateTestImports } from './utils/importValidator';
import { createScaffoldsForMissingImports } from './utils/scaffolder';
import { analyzeJestErrors, parseJestSummary } from './utils/jestErrorAnalyzer';
import { performPreTestHealthCheck, formatHealthCheckReport } from './utils/healthCheck';
import { formatError, formatErrorForLogging, ErrorContext } from './utils/errorFormatter';
import { detectTransientError, executeWithRetry } from './utils/transientErrorDetector';
import express from 'express';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio',
});

class AIJobRepositoryImpl {
  async findById(id: string) {
    const result = await pool.query('SELECT * FROM ai_jobs WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async updateStatus(id: string, status: AIJobStatus, startedAt?: Date, finishedAt?: Date) {
    const updates: string[] = [`status = $1`];
    const values: any[] = [status];
    let paramCount = 2;

    if (startedAt) {
      updates.push(`started_at = $${paramCount++}`);
      values.push(startedAt);
    }
    if (finishedAt) {
      updates.push(`finished_at = $${paramCount++}`);
      values.push(finishedAt);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE ai_jobs SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async addEvent(jobId: string, eventType: string, payload: any) {
    await pool.query(
      `INSERT INTO ai_job_events (job_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [jobId, eventType, JSON.stringify(payload)]
    );
  }
}

const jobRepo = new AIJobRepositoryImpl();

/**
 * Parse errors into actionable items with context
 */
async function parseErrorsIntoActionableItems(
  errors: string[],
  installOutput: string,
  buildOutput: string,
  testOutput: string,
  projectType: string,
  projectBasePath?: string
): Promise<any[]> {
  const actionableItems: any[] = [];
  
  // Group errors by type and extract context
  for (let i = 0; i < errors.length; i++) {
    const error = errors[i];
    
    // Try to extract file path, line number, and error message
    // Improved regex to capture full file paths including directories
    // Pattern 1: /path/to/file.js:line:column or /path/to/file.js:line
    const fileMatch1 = error.match(/((?:[\/\\]?[\w\-\.\/\\]+)+\.(?:ts|js|tsx|jsx|py|java|go|rs|jsx|tsx))(?::(\d+))?(?::(\d+))?/);
    // Pattern 2: file.js:line:column or file.js:line
    const fileMatch2 = error.match(/([\w\-\.\/\\]+\.(?:ts|js|tsx|jsx|py|java|go|rs))(?::(\d+))?(?::(\d+))?/);
    // Pattern 3: at /path/to/file.js:line:column
    const fileMatch3 = error.match(/at\s+((?:[\/\\]?[\w\-\.\/\\]+)+\.(?:ts|js|tsx|jsx|py|java|go|rs))(?::(\d+))?(?::(\d+))?/);
    // Pattern 4: in /path/to/file.js:line
    const fileMatch4 = error.match(/in\s+((?:[\/\\]?[\w\-\.\/\\]+)+\.(?:ts|js|tsx|jsx|py|java|go|rs))(?::(\d+))?/);
    // Pattern 5: line number only
    const lineMatch = error.match(/line\s+(\d+)/i);
    const errorTypeMatch = error.match(/(TypeError|ReferenceError|SyntaxError|ImportError|ModuleNotFoundError|CompilationError)/i);
    
    let filePath = null;
    let lineNumber = null;
    let errorType = 'unknown';
    
    // Try patterns in order of specificity
    if (fileMatch1) {
      filePath = fileMatch1[1];
      lineNumber = fileMatch1[2] ? parseInt(fileMatch1[2]) : (fileMatch1[3] ? parseInt(fileMatch1[3]) : null);
    } else if (fileMatch3) {
      filePath = fileMatch3[1];
      lineNumber = fileMatch3[2] ? parseInt(fileMatch3[2]) : (fileMatch3[3] ? parseInt(fileMatch3[3]) : null);
    } else if (fileMatch4) {
      filePath = fileMatch4[1];
      lineNumber = fileMatch4[2] ? parseInt(fileMatch4[2]) : null;
    } else if (fileMatch2) {
      filePath = fileMatch2[1];
      lineNumber = fileMatch2[2] ? parseInt(fileMatch2[2]) : (fileMatch2[3] ? parseInt(fileMatch2[3]) : null);
    } else if (lineMatch) {
      lineNumber = parseInt(lineMatch[1]);
    }
    
    // Clean up file path - remove leading/trailing spaces and normalize
    if (filePath) {
      filePath = filePath.trim();
      // Remove any duplicate path segments if present
      if (projectBasePath && filePath.includes(projectBasePath)) {
        // Extract relative path if absolute path contains base_path
        const path = require('path');
        const resolvedBasePath = path.resolve(projectBasePath);
        if (filePath.includes(resolvedBasePath)) {
          const lastIndex = filePath.lastIndexOf(resolvedBasePath);
          if (lastIndex >= 0) {
            filePath = filePath.substring(lastIndex + resolvedBasePath.length).replace(/^[/\\]+/, '');
          }
        }
      }
    }
    
    if (errorTypeMatch) {
      errorType = errorTypeMatch[1].toLowerCase();
    }
    
    // Determine category
    let category = 'other';
    if (error.includes('import') || error.includes('require') || error.includes('module')) {
      category = 'dependency';
    } else if (error.includes('type') || error.includes('Type')) {
      category = 'type';
    } else if (error.includes('syntax') || error.includes('Syntax')) {
      category = 'syntax';
    } else if (error.includes('test') || error.includes('Test') || error.includes('spec')) {
      category = 'test';
    } else if (error.includes('build') || error.includes('compile')) {
      category = 'build';
    }
    
    // Determine priority
    let priority = 'medium';
    if (category === 'syntax' || category === 'build') {
      priority = 'high';
    } else if (category === 'test') {
      priority = 'low';
    }
    
    actionableItems.push({
      id: `error-${i + 1}`,
      error_message: error,
      category,
      priority,
      file_path: filePath,
      line_number: lineNumber,
      error_type: errorType,
      suggested_fix: null, // Will be generated when user selects to fix
      status: 'pending', // pending, fixing, fixed, skipped
    });
  }
  
  return actionableItems;
}

/**
 * Emit project review event (store in review_status for polling)
 */
async function emitProjectReviewEvent(projectId: string, event: any) {
  try {
    // Get current review status
    const result = await pool.query(
      `SELECT review_status FROM projects WHERE id = $1`,
      [projectId]
    );
    
    if (result.rows.length === 0) return;
    
    const currentStatus = result.rows[0].review_status || { status: 'running', output: '' };
    
    // Update status with event data
    const updatedStatus: any = { ...currentStatus };
    
    if (event.type === 'progress') {
      updatedStatus.current_step = event.step;
      updatedStatus.progress = event.progress;
      updatedStatus.build_status = event.build_status || updatedStatus.build_status;
      updatedStatus.test_status = event.test_status || updatedStatus.test_status;
      updatedStatus.iterations = event.iterations || updatedStatus.iterations;
    } else if (event.type === 'output') {
      updatedStatus.output = (updatedStatus.output || '') + (event.content || '');
    } else if (event.type === 'error') {
      updatedStatus.errors = [...(updatedStatus.errors || []), event.message];
    } else if (event.type === 'completed') {
      updatedStatus.status = 'completed';
      updatedStatus.progress = 100;
    } else if (event.type === 'failed') {
      updatedStatus.status = 'failed';
    }
    
    // Update in database
    await pool.query(
      `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
      [JSON.stringify(updatedStatus), projectId]
    );
    
    console.log(`[Worker] Project review event for ${projectId}:`, event.type);
  } catch (error) {
    console.error(`[Worker] Error emitting project review event:`, error);
  }
}

/**
 * Build refactoring prompt with full AgentDB context
 */
async function buildRefactoringPromptWithAgentDB(
  project: any,
  story: any,
  tddContext: string,
  traceabilityChain: string,
  historyFromAgentDB: any[],
  testExecutionResults: any[],
  refactorAttempt: number,
  maxRefactorAttempts: number
): Promise<string> {
  const lines: string[] = [];
  
  lines.push(`# Automatic TDD Refactoring (Attempt ${refactorAttempt}/${maxRefactorAttempts})\n`);
  lines.push(`\n## 📋 Context from AgentDB\n`);
  lines.push(`\n**Project**: ${project.name}`);
  lines.push(`**Tech Stack**: ${project.tech_stack}`);
  lines.push(`**Story**: ${story.title}`);
  lines.push(`${story.description ? `**Description**: ${story.description}` : ''}\n`);
  
  lines.push(`\n### Traceability Chain (from AgentDB)\n`);
  lines.push(traceabilityChain);
  lines.push(`\n`);
  
  lines.push(`\n### TDD Context (from AgentDB)\n`);
  lines.push(tddContext);
  lines.push(`\n`);
  
  if (historyFromAgentDB && historyFromAgentDB.length > 0) {
    lines.push(`\n### Previous Attempts History (from AgentDB)\n`);
    lines.push(`The following shows what has been tried before:\n\n`);
    const recentHistory = historyFromAgentDB.slice(-10);
    for (const h of recentHistory) {
      lines.push(`- **[${h.phase}]** ${h.action}: ${h.result}${h.error ? ` - Error: ${h.error}` : ''}\n`);
    }
    lines.push(`\n`);
  }
  
  lines.push(`\n## ❌ Test Failures (Current Attempt)\n`);
  lines.push(`\n**Total Failed**: ${testExecutionResults.length}\n`);
  lines.push(`\n`);
  
  for (const test of testExecutionResults) {
    lines.push(`\n### Test: ${test.name}\n`);
    lines.push(`**File**: \`${test.file_path}\`\n`);
    lines.push(`\n**Test Output**:\n`);
    lines.push(`\`\`\`\n`);
    lines.push(test.output || 'No output available');
    lines.push(`\n\`\`\`\n`);
    
    if (test.error_message) {
      lines.push(`\n**Error Message**:\n`);
      lines.push(`\`\`\`\n`);
      lines.push(test.error_message);
      lines.push(`\n\`\`\`\n`);
    }
    lines.push(`\n---\n`);
  }
  
  lines.push(`\n## 🎯 Your Task\n`);
  lines.push(`\nYou are in a **TDD refactoring cycle**. The implementation exists but tests are failing.\n`);
  lines.push(`\n**Refactoring Attempt**: ${refactorAttempt} of ${maxRefactorAttempts}\n`);
  lines.push(`\n### What you MUST do:\n`);
  lines.push(`\n1. **Analyze the test failures** using the context from AgentDB`);
  lines.push(`2. **Review previous attempts** in the history to avoid repeating mistakes`);
  lines.push(`3. **Fix ONLY the implementation code** (tests are locked in AgentDB)`);
  lines.push(`4. **Make minimal, targeted changes** to pass the tests`);
  lines.push(`5. **Maintain traceability** with PRD → RFC → Story chain from AgentDB\n`);
  
  lines.push(`\n### Critical Rules (from AgentDB context):\n`);
  lines.push(`\n- ⛔ **NEVER modify test files** (tests are the source of truth in TDD)`);
  lines.push(`- ✅ **ONLY modify implementation code** in backend/src/, frontend/src/, mobile/src/`);
  lines.push(`- ✅ **Use TypeScript** (.ts files only) - DO NOT create .js files`);
  lines.push(`- ✅ **Follow MVC structure** - backend/src/services/, backend/src/models/, etc.`);
  lines.push(`- ✅ **Keep it simple** - Fix root cause, don't patch symptoms`);
  lines.push(`- ✅ **Read the test output carefully** - It tells you exactly what's wrong\n`);
  
  lines.push(`\n### 🚨 CRITICAL FILE LOCATION RULES\n`);
  lines.push(`\n**FORBIDDEN LOCATIONS - DO NOT CREATE FILES HERE:**`);
  lines.push(`❌ Root \`src/\` directory (e.g., \`src/lib/\`, \`src/services/\`, \`src/pages/\`)`);
  lines.push(`❌ Root \`lib/\` directory`);
  lines.push(`❌ Root \`pages/\` directory`);
  lines.push(`❌ Root \`services/\` directory\n`);
  lines.push(`\n**REQUIRED LOCATIONS - CREATE FILES HERE:**`);
  lines.push(`✅ Backend files → \`backend/src/\` (lib, services, controllers, models, routes, middleware, config)`);
  lines.push(`✅ Frontend files → \`frontend/src/\` (components, pages, hooks, services, utils)`);
  lines.push(`✅ Mobile files → \`mobile/src/\` (screens, components, navigation, services, utils)`);
  lines.push(`✅ Shared code → \`shared/\` (types, utils, constants)`);
  lines.push(`✅ Database files → \`database/\` (migrations, scripts, seeds)\n`);
  
  if (refactorAttempt > 1) {
    lines.push(`\n### What Changed From Previous Attempt:\n`);
    lines.push(`\nReview the history above to see what was tried before.`);
    lines.push(`**Avoid making the same changes that led to failure.**`);
    lines.push(`Try a different approach this time.\n`);
  } else {
    lines.push(`\n### First Refactoring Attempt:\n`);
    lines.push(`\nThis is the first attempt to fix the failing tests.`);
    lines.push(`Analyze the test output carefully to understand the root cause.\n`);
  }
  
  lines.push(`\n## 📦 AgentDB Context Available\n`);
  lines.push(`\nAll context is stored in AgentDB:`);
  lines.push(`- Original tests and requirements`);
  lines.push(`- Previous implementation attempts`);
  lines.push(`- Traceability chain (PRD → RFC → Story → Tests → Code)`);
  lines.push(`- History of all actions and their results\n`);
  lines.push(`\nUse this context to make informed refactoring decisions.\n`);
  
  lines.push(`\n**Start refactoring now. Focus on making the failing tests pass.**\n`);
  
  return lines.join('');
}

/**
 * Update breakdown task status to 'done' when coding session completes
 */
async function updateBreakdownTaskStatus(codingSessionId: string) {
  try {
    console.log(`[Worker] Attempting to update breakdown task status for coding session ${codingSessionId}`);
    
    // Get the story_id (which is the task_id) from the coding session
    const sessionResult = await pool.query(
      'SELECT story_id FROM coding_sessions WHERE id = $1',
      [codingSessionId]
    );
    
    if (sessionResult.rows.length === 0) {
      console.warn(`[Worker] Coding session ${codingSessionId} not found for task status update`);
      return;
    }
    
    const taskId = sessionResult.rows[0].story_id;
    console.log(`[Worker] Found task_id ${taskId} for coding session ${codingSessionId}`);
    
    // Verify it's a breakdown task (type = 'task' and has epic_id)
    const taskResult = await pool.query(
      'SELECT id, type, epic_id, status, title FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskResult.rows.length === 0) {
      console.warn(`[Worker] Task ${taskId} not found for status update`);
      return;
    }
    
    const task = taskResult.rows[0];
    console.log(`[Worker] Task details: id=${task.id}, type=${task.type}, epic_id=${task.epic_id}, current_status=${task.status}, title=${task.title}`);
    
    // Only update if it's a breakdown task (type = 'task' and has epic_id)
    if (task.type === 'task' && task.epic_id) {
      const updateResult = await pool.query(
        'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status',
        ['done', taskId]
      );
      
      if (updateResult.rows.length > 0) {
        console.log(`[Worker] ✅ Successfully updated breakdown task ${taskId} (${task.title}) status from '${task.status}' to 'done' after coding session ${codingSessionId} completed`);
      } else {
        console.warn(`[Worker] ⚠️ Update query returned no rows for task ${taskId}`);
      }
    } else {
      console.log(`[Worker] ⏭️ Task ${taskId} is not a breakdown task (type: ${task.type}, epic_id: ${task.epic_id}), skipping status update`);
    }
  } catch (error: any) {
    console.error(`[Worker] ❌ Error updating breakdown task status for session ${codingSessionId}:`, error);
    console.error(`[Worker] Error details:`, error.message, error.stack);
    // Don't throw - this is a side effect, shouldn't fail the main process
  }
}

async function processJob(jobId: string) {
  const job = await jobRepo.findById(jobId);
  if (!job) {
    console.error(`Job ${jobId} not found`);
    return;
  }

  if (job.status !== 'pending') {
    console.log(`Job ${jobId} is not pending, skipping`);
    return;
  }

  console.log(`Processing job ${jobId} with provider ${job.provider}`);

  // Update status to running
  await jobRepo.updateStatus(jobId, 'running', new Date());

  try {
    const provider = job.provider as AIProvider;
    const mode = job.args.mode as AIMode;
    const prompt = job.args.prompt as string;
    const projectPath = (job.args.project_path || job.args.base_path) as string;

    let cli;
    if (provider === 'cursor') {
      // Use cursor-agent CLI (installed via: curl https://cursor.com/install -fsS | bash)
      // cursor-agent --background runs without opening the IDE
      cli = new CursorCLI();
      console.log('[Worker] Usando cursor-agent CLI (modo background, no abre IDE)');
    } else if (provider === 'claude') {
      // Intentar usar Claude API primero (no abre IDE), fallback a CLI
      const { ClaudeAPI } = await import('./cli/claudeApi');
      const claudeApi = new ClaudeAPI();
      
      // Si tiene API key, usar API (no abre IDE)
      if (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY) {
        console.log('[Worker] Usando Claude API (no abre IDE)');
        cli = claudeApi;
      } else {
        // Fallback a CLI (puede abrir IDE)
        console.warn('[Worker] No Claude API key encontrada, usando CLI (puede abrir IDE)');
        cli = new ClaudeCLI();
      }
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Check if this is a coding session job
    const codingSessionId = job.args.coding_session_id;
    const phase = job.args.phase; // 'test_generation', 'test_generation_after', 'implementation', 'tdd_red', 'tdd_green', 'tdd_refactor', 'tdd_individual_retry', or 'story_generation'
    const isCodingSession = mode === 'agent' && codingSessionId;
    const isTestGeneration = isCodingSession && (phase === 'test_generation' || phase === 'test_generation_after');
    const isImplementation = isCodingSession && (phase === 'implementation' || phase === 'tdd_all_at_once' || phase === 'tdd_refactor');
    const isTDDPhase = isCodingSession && (phase === 'tdd_green' || phase === 'tdd_refactor'); // RED phase removed
    const isIndividualRetry = isCodingSession && phase === 'tdd_individual_retry'; // Hybrid retry system
    
    // Check if this is a story generation job
    const prdId = job.args.prd_id;
    const isStoryGeneration = mode === 'agent' && phase === 'story_generation' && prdId;
    
    // Check if this is an RFC generation job
    const rfcId = job.args.rfc_id;
    const isRFCGeneration = mode === 'agent' && phase === 'rfc_generation';
    
    // Check if this is a breakdown generation job
    const isBreakdownGeneration = mode === 'agent' && phase === 'breakdown_generation';
    
    // Check if this is a user flow generation job
    const userFlowId = job.args.user_flow_id;
    const isUserFlowGeneration = mode === 'agent' && phase === 'user_flow_generation';
    
    // Check if this is a prototype analysis job
    const prototypeId = job.args.prototype_id;
    const isPrototypeAnalysis = mode === 'agent' && phase === 'prototype_analysis';
    
    // Check if this is a QA session job
    const qaSessionId = job.args.qa_session_id;
    const isQASession = mode === 'agent' && qaSessionId;
    
    // Check if this is a code review job (for individual sessions)
    const isCodeReview = mode === 'review' && phase === 'code_review' && codingSessionId;
    
    // Check if this is a project-wide review job
    const isProjectReview = mode === 'review' && phase === 'project_review' && job.project_id;
    
    // Check if this is a project review fix job (fixing selected errors)
    const isProjectReviewFix = mode === 'agent' && phase === 'project_review_fix' && job.project_id;

    // Check if coding session is paused
    if (isCodingSession) {
      const sessionCheck = await pool.query(
        'SELECT status FROM coding_sessions WHERE id = $1',
        [codingSessionId]
      );
      
      if (sessionCheck.rows.length > 0 && sessionCheck.rows[0].status === 'paused') {
        console.log(`[Worker] Coding session ${codingSessionId} is paused, skipping job ${jobId}`);
        // Keep job as pending so it can be picked up later if resumed
        return;
      }
    }

    // Update coding session status based on phase
    if (isTestGeneration) {
      await pool.query(
        'UPDATE coding_sessions SET status = $1, started_at = $2 WHERE id = $3',
        ['generating_tests', new Date(), codingSessionId]
      );
      console.log(`[Worker] Test generation started for coding session ${codingSessionId}`);
    } else if (isImplementation) {
      // For tdd_all_at_once, keep status as tdd_implementing, otherwise set to running
      const status = phase === 'tdd_all_at_once' ? 'tdd_implementing' : 'running';
      await pool.query(
        'UPDATE coding_sessions SET status = $1, started_at = COALESCE(started_at, $2) WHERE id = $3',
        [status, new Date(), codingSessionId]
      );
      if (phase === 'tdd_all_at_once') {
        console.log(`[Worker] TDD all-at-once implementation started for coding session ${codingSessionId}`);
      } else {
        console.log(`[Worker] Implementation started for coding session ${codingSessionId}`);
      }
    }

    // Set up event handlers
    cli.on('output', async (data: string) => {
      await jobRepo.addEvent(jobId, 'progress', { output: data });
      
      // Update coding session with output
      if (isCodingSession) {
        try {
          if (isTestGeneration) {
            // Update tests_output and test_progress
            const result = await pool.query(
              'SELECT tests_output, test_progress FROM coding_sessions WHERE id = $1',
              [codingSessionId]
            );
            const currentTestsOutput = result.rows[0]?.tests_output || '';
            const currentTestProgress = result.rows[0]?.test_progress || 0;
            const newTestProgress = Math.min(50, currentTestProgress + 1); // Max 50% for test phase
            
            await pool.query(
              'UPDATE coding_sessions SET tests_output = $1, test_progress = $2, progress = $3 WHERE id = $4',
              [currentTestsOutput + data, newTestProgress, newTestProgress, codingSessionId]
            );
            
            // Verify session exists before inserting event
            const sessionCheck = await pool.query(
              'SELECT id FROM coding_sessions WHERE id = $1',
              [codingSessionId]
            );
            
            if (sessionCheck.rows.length > 0) {
              await pool.query(
                'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                [codingSessionId, 'output', JSON.stringify({ output: data, test_progress: newTestProgress })]
              );
            } else {
              console.warn(`[Worker] ⚠️ Cannot insert event - session ${codingSessionId} does not exist`);
            }
          } else if (isImplementation) {
            // Update output and implementation_progress
            const result = await pool.query(
              'SELECT output, implementation_progress FROM coding_sessions WHERE id = $1',
              [codingSessionId]
            );
            const currentOutput = result.rows[0]?.output || '';
            const currentImplProgress = result.rows[0]?.implementation_progress || 0;
            const newImplProgress = Math.min(50, currentImplProgress + 1); // Max 50% for implementation phase
            const totalProgress = 50 + newImplProgress; // 50% from tests + implementation progress
            
            await pool.query(
              'UPDATE coding_sessions SET output = $1, implementation_progress = $2, progress = $3 WHERE id = $4',
              [currentOutput + data, newImplProgress, totalProgress, codingSessionId]
            );
            
            // Verify session exists before inserting event
            const sessionCheck = await pool.query(
              'SELECT id FROM coding_sessions WHERE id = $1',
              [codingSessionId]
            );
            
            if (sessionCheck.rows.length > 0) {
              await pool.query(
                'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                [codingSessionId, 'output', JSON.stringify({ output: data, implementation_progress: newImplProgress, progress: totalProgress })]
              );
            } else {
              console.warn(`[Worker] ⚠️ Cannot insert event - session ${codingSessionId} does not exist`);
            }
          }
        } catch (error) {
          console.error('[Worker] Error updating coding session output:', error);
        }
      }
    });

    cli.on('error', async (data: string) => {
      await jobRepo.addEvent(jobId, 'error', { error: data });
      
      // Update coding session with error
      if (isCodingSession) {
        try {
          // Verify session exists before inserting event
          const sessionCheck = await pool.query(
            'SELECT id FROM coding_sessions WHERE id = $1',
            [codingSessionId]
          );
          
          if (sessionCheck.rows.length > 0) {
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'error', JSON.stringify({ error: data })]
            );
          } else {
            console.warn(`[Worker] ⚠️ Cannot insert error event - session ${codingSessionId} does not exist`);
          }
        } catch (error) {
          console.error('[Worker] Error logging coding session error:', error);
        }
      }
    });

    // Execute CLI command with complete PRD in prompt
    // The prompt contains the full PRD (idea del proyecto) as context
    console.log(`[Worker] Executing ${provider} CLI command for job ${jobId}`);
    console.log(`[Worker] Prompt includes PRD: ${prompt.includes('PRD') || prompt.includes('Product Requirements Document')}`);
    console.log(`[Worker] Prompt length: ${prompt.length} characters`);
    
    // Add delay for test generation jobs to avoid rate limiting
    const isTestGenJob = phase === 'test_generation' || job.args.phase === 'test_generation';
    if (isTestGenJob) {
      // Longer delay for test generation to avoid rate limiting
      const delay = 8000; // 8 seconds
      console.log(`[Worker] Test generation job - adding ${delay/1000}s delay to avoid rate limiting`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Retry logic for resource_exhausted errors with exponential backoff
    let result;
    let retries = 5; // Increased retries
    let retryDelay = 10000; // Start with 10 seconds (increased)
    
    while (retries > 0) {
      try {
        result = await cli.execute(mode, prompt, projectPath, { timeout: 600000 }); // 10 min timeout (increased)
        
        // Check if error contains resource_exhausted
        if (!result.success && result.error && (
          result.error.includes('resource_exhausted') || 
          result.error.includes('ConnectError') ||
          result.error.includes('rate limit')
        )) {
          retries--;
          if (retries > 0) {
            console.log(`[Worker] Resource exhausted error detected. Retrying in ${retryDelay/1000}s... (${retries} retries left)`);
            // Exponential backoff with jitter
            const jitter = Math.random() * 2000; // 0-2s random jitter
            await new Promise(resolve => setTimeout(resolve, retryDelay + jitter));
            retryDelay = Math.min(retryDelay * 2, 120000); // Cap at 2 minutes
            continue;
          } else {
            console.error(`[Worker] Max retries reached for resource_exhausted error`);
          }
        } else {
          // Success or non-retryable error, break the loop
          break;
        }
      } catch (error: any) {
        const errorMessage = error.message || String(error);
        if (errorMessage.includes('resource_exhausted') || 
            errorMessage.includes('ConnectError') ||
            errorMessage.includes('rate limit')) {
          retries--;
          if (retries > 0) {
            console.log(`[Worker] Resource exhausted exception. Retrying in ${retryDelay/1000}s... (${retries} retries left)`);
            // Exponential backoff with jitter
            const jitter = Math.random() * 2000; // 0-2s random jitter
            await new Promise(resolve => setTimeout(resolve, retryDelay + jitter));
            retryDelay = Math.min(retryDelay * 2, 120000); // Cap at 2 minutes
            continue;
          } else {
            console.error(`[Worker] Max retries reached for resource_exhausted exception`);
            result = {
              success: false,
              output: '',
              error: errorMessage,
            };
            break;
          }
        } else {
          // Non-retryable error, break the loop
          result = {
            success: false,
            output: '',
            error: errorMessage,
          };
          break;
        }
      }
    }
    
    console.log(`[Worker] CLI execution completed. Success: ${result.success}`);
    if (result.output) {
      console.log(`[Worker] Output length: ${result.output.length} characters`);
    }
    if (result.error) {
      console.log(`[Worker] Error: ${result.error.substring(0, 500)}`);
    }

    // Update status - also process if we have output even if success is false
    // (sometimes CLI returns success=false but still has useful output)
    if (result.success || (result.output && result.output.length > 0 && !result.error)) {
      await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
      await jobRepo.addEvent(jobId, 'completed', { output: result.output });
      
      // Handle coding session completion based on phase
      if (isTestGeneration) {
        // Test generation completed
        try {
          const sessionResult = await pool.query(
            'SELECT project_id, story_id, programmer_type FROM coding_sessions WHERE id = $1',
            [codingSessionId]
          );
          
          if (sessionResult.rows.length > 0) {
            const session = sessionResult.rows[0];
            
            // Parse generated tests and create test suites (only unit tests)
            const testSuites = await parseAndSaveTestSuites(
              session.project_id,
              codingSessionId,
              session.story_id,
              result.output,
              session.programmer_type
            );
            
            if (phase === 'test_generation_after') {
              // Test generation AFTER implementation - mark as completed
              await pool.query(
                'UPDATE coding_sessions SET status = $1, test_progress = $2, progress = $3, tests_output = $4, completed_at = $5 WHERE id = $6',
                ['completed', 50, 100, result.output, new Date(), codingSessionId]
              );
              
              await pool.query(
                'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                [codingSessionId, 'completed', JSON.stringify({ 
                  tests_output: result.output, 
                  test_suites: testSuites.map(ts => ts.id),
                  message: `Generated ${testSuites.length} unit test suites after implementation` 
                })]
              );
              
              console.log(`[Worker] Generated ${testSuites.length} unit test suites for coding session ${codingSessionId} (after implementation)`);
              
              // Update breakdown task status to 'done'
              await updateBreakdownTaskStatus(codingSessionId);
              
              // Verify that the session is not in a final state before executing tests
              const sessionStatusCheck = await pool.query(
                'SELECT status FROM coding_sessions WHERE id = $1',
                [codingSessionId]
              );

              if (sessionStatusCheck.rows.length > 0) {
                const currentStatus = sessionStatusCheck.rows[0].status;
                
                // Only execute tests if the session is not in a final state
                if (currentStatus !== 'completed' && currentStatus !== 'failed') {
                  // Automatically execute test suites
                  try {
                    await executeTestSuitesForSession(codingSessionId);
                  } catch (testError) {
                    console.error('[Worker] Error executing test suites:', testError);
                  }
                } else {
                  console.log(`[Worker] ⏭️ Skipping test execution - session already in final state: ${currentStatus}`);
                }
              }
            } else {
              // TDD: Test generation BEFORE implementation
              const tddMode = job.args?.tdd_mode; // Check if strict TDD mode is enabled
              
              if (tddMode === 'strict') {
                // STRICT TDD: Initialize Red-Green-Refactor cycle
                console.log(`[Worker] Initializing strict TDD cycle for session ${codingSessionId}`);
                
                // Parse generated tests from AI output
                const parsedTests = await parseGeneratedTests(result.output);
                
                if (parsedTests.length === 0) {
                  console.error('[Worker] No tests found in AI output. Cannot initialize TDD cycle.');
                  await pool.query(
                    'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
                    ['failed', 'No tests generated', codingSessionId]
                  );
                  return;
                }
                
                // Initialize TDD cycle via CodingSessionService
                try {
                  // Import CodingSessionService dynamically
                  const codingSessionServicePath = path.join(__dirname, '../../backend/src/services/codingSessionService');
                  const { CodingSessionService } = await import(codingSessionServicePath);
                  const codingSessionService = new CodingSessionService();
                  
                  await codingSessionService.initializeTDDCycle(codingSessionId, parsedTests);
                  
                  console.log(`[Worker] TDD cycle initialized with ${parsedTests.length} tests. Starting RED phase.`);
                } catch (error) {
                  console.error('[Worker] Error initializing TDD cycle:', error);
                  await pool.query(
                    'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
                    ['failed', `TDD initialization failed: ${error}`, codingSessionId]
                  );
                }
              } else {
                // LEGACY TDD: Save tests and start implementation (old behavior)
                await pool.query(
                  'UPDATE coding_sessions SET status = $1, test_progress = $2, progress = $3, tests_output = $4 WHERE id = $5',
                  ['tests_generated', 50, 50, result.output, codingSessionId]
                );

                await pool.query(
                  'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                  [codingSessionId, 'tests_generated', JSON.stringify({
                    tests_output: result.output,
                    test_suites: testSuites.map(ts => ts.id),
                    message: `Generated ${testSuites.length} unit test suites successfully`
                  })]
                );

                console.log(`[Worker] Generated ${testSuites.length} unit test suites for coding session ${codingSessionId}`);

                // Validate generated tests by attempting to execute them
                console.log(`[Worker] 🧪 Validating generated tests for session ${codingSessionId}...`);
                try {
                  await validateGeneratedTests(codingSessionId, session.project_id);
                } catch (validationError) {
                  console.warn('[Worker] ⚠️  Test validation failed, but continuing with implementation:', validationError);
                  // Log validation failure as event but don't block implementation
                  await pool.query(
                    'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                    [codingSessionId, 'error', JSON.stringify({
                      message: 'Test validation failed',
                      error: validationError instanceof Error ? validationError.message : String(validationError)
                    })]
                  );
                }
                
                // Now create implementation job
                const projectResult = await pool.query('SELECT base_path, name, tech_stack FROM projects WHERE id = $1', [session.project_id]);
                const project = projectResult.rows[0];
                const storyResult = await pool.query('SELECT title, description, priority FROM tasks WHERE id = $1', [session.story_id]);
                const story = storyResult.rows[0];
                
                // Build implementation prompt with generated tests
                const implPrompt = await buildImplementationPrompt(project, story, session.programmer_type, result.output);
                
                const implJob = await pool.query(
                  `INSERT INTO ai_jobs (project_id, provider, command, args, status)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING *`,
                  [
                    session.project_id,
                    'cursor',
                    'cursor',
                    JSON.stringify({
                      mode: 'agent',
                      prompt: implPrompt,
                      project_path: project.base_path,
                      coding_session_id: codingSessionId,
                      phase: 'implementation',
                    }),
                    'pending'
                  ]
                );
                
                // Update session with implementation job ID
                await pool.query(
                  'UPDATE coding_sessions SET implementation_job_id = $1, ai_job_id = $2 WHERE id = $3',
                  [implJob.rows[0].id, implJob.rows[0].id, codingSessionId]
                );
                
                console.log(`[Worker] Implementation job ${implJob.rows[0].id} created for session ${codingSessionId}`);
              }
            }
          }
        } catch (error) {
          console.error('[Worker] Error processing test generation completion:', error);
        }
      } else if (isIndividualRetry) {
        // Individual test retry completed (Hybrid Retry System)
        try {
          console.log(`[Worker] Individual retry job completed for session ${codingSessionId}`);

          const testRetryTrackingId = job.args.test_retry_tracking_id;

          if (!testRetryTrackingId) {
            console.error('[Worker] No test_retry_tracking_id in job args for individual retry');
            return;
          }

          // Import RetryOrchestrator
          const { RetryOrchestrator } = await import('./retryOrchestrator');
          const orchestrator = new RetryOrchestrator(pool);

          // Handle retry job completion
          await orchestrator.handleRetryJobComplete(
            jobId,
            codingSessionId,
            testRetryTrackingId,
            {
              success: result.success,
              output: result.output,
              error: result.error
            }
          );

          console.log(`[Worker] Individual retry handled for test ${testRetryTrackingId}`);
        } catch (error) {
          console.error('[Worker] Error processing individual retry completion:', error);
        }
      } else if (isImplementation) {
        // Implementation completed
        try {
          const testStrategy = job.args?.test_strategy || 'tdd';
          const isTDDAllAtOnce = phase === 'tdd_all_at_once';
          const isTDDRefactor = phase === 'tdd_refactor';
          
          // For TDD refactoring, re-run tests to verify fix
          if (isTDDRefactor) {
            console.log(`[Worker] TDD refactoring completed for session ${codingSessionId}. Re-running tests...`);
            
            // Re-execute tests to verify the refactoring fixed the issues
            // Include failed tests so we can re-run them after refactoring
            try {
              await executeTestSuitesForSession(codingSessionId, true);
              
              // Check test results
              const testStatusResult = await pool.query(
                `SELECT 
                  COUNT(*) as total_suites,
                  SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed_suites,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_suites
                 FROM test_suites 
                 WHERE coding_session_id = $1`,
                [codingSessionId]
              );
              
              if (testStatusResult.rows.length > 0) {
                const testStatus = testStatusResult.rows[0];
                const allPassed = (testStatus.failed_suites || 0) === 0 && (testStatus.total_suites || 0) > 0;
                
                if (allPassed) {
                  // Success! Tests now pass after refactoring
                  console.log(`[Worker] ✅ Refactoring successful! All tests now pass.`);
                  
                  // Update AgentDB state
                  const projectResult = await pool.query(
                    'SELECT base_path FROM projects WHERE id = (SELECT project_id FROM coding_sessions WHERE id = $1)',
                    [codingSessionId]
                  );
                  const projectPath = projectResult.rows[0]?.base_path;
                  
                  const { AgentDBStateManager } = await import('../../backend/src/services/agentdb/AgentDBStateManager');
                  const stateManager = new AgentDBStateManager(projectPath, codingSessionId);
                  
                  // Note: updatePhase expects 'green' | 'refactor', using appendHistory instead
                  await stateManager.appendHistory({
                    timestamp: new Date().toISOString(),
                    phase: 'refactor',
                    action: 'Refactoring completed successfully',
                    result: 'success',
                    files_modified: []
                  });
                  
                  await pool.query(
                    'UPDATE coding_sessions SET status = $1, error = NULL, implementation_progress = $2 WHERE id = $3',
                    ['completed', 50, codingSessionId]
                  );
                  
                  await pool.query(
                    'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                    [codingSessionId, 'completed', JSON.stringify({
                      message: 'TDD cycle completed successfully after refactoring',
                      refactor_attempts: job.args?.refactor_attempt || 1,
                      test_summary: {
                        total: parseInt(testStatus.total_suites || '0'),
                        passed: parseInt(testStatus.passed_suites || '0'),
                        failed: parseInt(testStatus.failed_suites || '0')
                      }
                    })]
                  );
                  
                  console.log(`[Worker] ✅ Session ${codingSessionId} completed successfully after refactoring`);
                  return;
                }
                // If tests still failing, continue to regular tdd_all_at_once logic below
                // which will trigger another refactoring cycle if attempts remain
              }
            } catch (testError: any) {
              console.error('[Worker] Error re-running tests after refactoring:', testError);
            }
          }
          
          // For TDD all-at-once, handle completion differently
          if (isTDDAllAtOnce || isTDDRefactor) {
            console.log(`[Worker] TDD all-at-once implementation completed for session ${codingSessionId}`);
            console.log(`[Worker] ⚠️ IMPORTANT: Validating tests BEFORE marking as completed`);

            // Clean up incorrectly placed files (move from root src/ to MVC directories)
            try {
              // Get project_id from coding session
              const sessionResult = await pool.query(
                'SELECT project_id FROM coding_sessions WHERE id = $1',
                [codingSessionId]
              );
              if (sessionResult.rows.length > 0) {
                const projectId = sessionResult.rows[0].project_id;
                const codingSessionServicePath = path.join(__dirname, '../../backend/src/services/codingSessionService');
                const { CodingSessionService } = await import(codingSessionServicePath);
                const codingSessionService = new CodingSessionService();
                const cleanupResult = await codingSessionService.cleanupIncorrectlyPlacedFiles(projectId);
                console.log(`[Worker] Cleanup result: ${cleanupResult.moved} files moved, ${cleanupResult.deleted} duplicates deleted`);
                if (cleanupResult.errors.length > 0) {
                  console.warn(`[Worker] Cleanup errors:`, cleanupResult.errors);
                }
              }
            } catch (cleanupError) {
              console.error('[Worker] Error during cleanup:', cleanupError);
              // Don't fail the session if cleanup fails
            }

            // ✅ CRITICAL FIX: Execute test suites BEFORE marking as completed
            // This validates that the implementation actually works
            let allTestsPassed = false;
            let testSummary = { total: 0, passed: 0, failed: 0, skipped: 0 };

            try {
              console.log(`[Worker] 🧪 Executing test suites to validate implementation...`);
              await executeTestSuitesForSession(codingSessionId, true);
              
              // Check if all test suites passed
              const testStatusResult = await pool.query(
                `SELECT 
                  COUNT(*) as total_suites,
                  SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed_suites,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_suites,
                  SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_suites
                 FROM test_suites 
                 WHERE coding_session_id = $1`,
                [codingSessionId]
              );
              
              if (testStatusResult.rows.length > 0) {
                const testStatus = testStatusResult.rows[0];
                testSummary = {
                  total: parseInt(testStatus.total_suites || '0'),
                  passed: parseInt(testStatus.passed_suites || '0'),
                  failed: parseInt(testStatus.failed_suites || '0'),
                  skipped: parseInt(testStatus.skipped_suites || '0')
                };
                
                allTestsPassed = testSummary.failed === 0 && testSummary.total > 0;

                if (!allTestsPassed) {
                  console.warn(`[Worker] ⚠️ Tests failed after TDD all-at-once. Failed: ${testSummary.failed}, Total: ${testSummary.total}`);
                  console.warn(`[Worker] ⚠️ Following TDD principles: Starting automatic retry system.`);

                  // Get failed test suites
                  const failedTestsResult = await pool.query(
                    `SELECT id, name, test_code FROM test_suites
                     WHERE coding_session_id = $1 AND status = 'failed'`,
                    [codingSessionId]
                  );

                  const failedTests = failedTestsResult.rows.map((row: any) => ({
                    id: row.id,
                    name: row.name,
                    test_code: row.test_code,
                    error_message: row.error || 'Unknown error'
                  }));

                  // Use hybrid or legacy system based on feature flag
                  if (ENABLE_HYBRID_RETRY_SYSTEM) {
                    await handleFailedTestsHybrid(codingSessionId, failedTests);
                  } else {
                    await handleFailedTestsLegacy(codingSessionId, testSummary);
                  }

                  return; // Exit early - retry system will handle completion
                }

                // Tests passed - mark as completed
                console.log(`[Worker] ✅ All tests passed (${testSummary.passed}/${testSummary.total}). TDD cycle complete.`);

                // ✅ CRITICAL FIX: Mark as completed ONLY AFTER tests pass
                await pool.query(
                  'UPDATE coding_sessions SET status = $1, error = NULL, implementation_progress = $2, progress = $3, completed_at = $4 WHERE id = $5',
                  ['completed', 50, 100, new Date(), codingSessionId]
                );

                // Emit event for successful TDD completion
                await pool.query(
                  'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                  [codingSessionId, 'completed', JSON.stringify({
                    message: 'TDD cycle completed successfully - all tests passing',
                    phase: 'tdd_all_at_once',
                    test_summary: testSummary
                  })]
                );

                // Update breakdown task status to 'done'
                await updateBreakdownTaskStatus(codingSessionId);
                console.warn(`[Worker] ⚠️ No test suites found for session ${codingSessionId}. TDD requires tests first.`);
                await pool.query(
                  'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
                  ['failed', 'TDD cycle incomplete: No test suites found. Tests must be generated first (TDD principle).', codingSessionId]
                );
                
                await pool.query(
                  'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                  [codingSessionId, 'error', JSON.stringify({
                    message: 'TDD cycle incomplete: No tests found',
                    reason: 'TDD requires tests first, then code',
                    action_required: 'generate_tests'
                  })]
                );
                return;
              }
            } catch (testError: any) {
              console.error('[Worker] Error executing test suites after TDD all-at-once:', testError);
              // If test execution itself fails, mark session as failed
              await pool.query(
                'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
                ['failed', `Test execution error: ${testError.message}. TDD cycle incomplete.`, codingSessionId]
              );
              
              await pool.query(
                'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                [codingSessionId, 'error', JSON.stringify({
                  message: 'Test execution failed',
                  error: testError.message,
                  action_required: 'retry_tests'
                })]
              );
              return; // Exit early
            }

            // ✅ Tests executed and validated - session marked as completed above
            console.log(`[Worker] ✅ TDD all-at-once cycle completed for session ${codingSessionId}`);
            console.log(`[Worker] ℹ️  No QA session created - TDD cycle is self-contained`);

            return; // Exit early, don't process as regular implementation
          }
          
          // Check if we need to generate tests after implementation
          if (testStrategy === 'after') {
            // Generate unit tests after implementation
            console.log(`[Worker] Implementation completed for session ${codingSessionId}, generating unit tests...`);
            
            const sessionResult = await pool.query(
              'SELECT project_id, story_id, programmer_type FROM coding_sessions WHERE id = $1',
              [codingSessionId]
            );
            
            if (sessionResult.rows.length > 0) {
              const session = sessionResult.rows[0];
              const storyResult = await pool.query('SELECT title, description, priority FROM tasks WHERE id = $1', [session.story_id]);
              const story = storyResult.rows[0];
              
              // Build test generation prompt (unit tests only)
              const testPrompt = await buildTestGenerationPromptAfterImplementation(session.project_id, story, session.programmer_type, result.output);
              
              const testJob = await pool.query(
                `INSERT INTO ai_jobs (project_id, provider, command, args, status)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [
                  session.project_id,
                  'cursor',
                  'cursor',
                  JSON.stringify({
                    mode: 'agent',
                    prompt: testPrompt,
                    coding_session_id: codingSessionId,
                    phase: 'test_generation_after',
                    test_strategy: 'after',
                    unit_tests_only: true,
                  }),
                  'pending'
                ]
              );
              
              await pool.query(
                'UPDATE coding_sessions SET test_generation_job_id = $1, status = $2 WHERE id = $3',
                [testJob.rows[0].id, 'generating_tests', codingSessionId]
              );
              
              console.log(`[Worker] Test generation job ${testJob.rows[0].id} created for session ${codingSessionId} (after implementation)`);
            }
          } else if (testStrategy === 'none') {
            // No testing: Mark session as done without generating or executing tests
            await pool.query(
              'UPDATE coding_sessions SET status = $1, implementation_progress = $2, progress = $3, completed_at = $4 WHERE id = $5',
              ['completed', 50, 100, new Date(), codingSessionId]
            );
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'completed', JSON.stringify({ message: 'Implementation completed successfully (no tests generated)' })]
            );
            console.log(`[Worker] Coding session ${codingSessionId} completed (no testing)`);
            
            // Update breakdown task status to 'done'
            await updateBreakdownTaskStatus(codingSessionId);
            
            // Automatically trigger QA session (but skip test execution)
            try {
              const codingSession = await pool.query(
                'SELECT project_id FROM coding_sessions WHERE id = $1',
                [codingSessionId]
              );
              
              if (codingSession.rows.length > 0) {
                const projectId = codingSession.rows[0].project_id;
                
                // Create QA session
                const qaSession = await pool.query(
                  'INSERT INTO qa_sessions (project_id, coding_session_id, status) VALUES ($1, $2, $3) RETURNING *',
                  [projectId, codingSessionId, 'pending']
                );
                
                const qaSessionId = qaSession.rows[0].id;
                console.log(`[Worker] Created QA session ${qaSessionId} for coding session ${codingSessionId}`);
                
                // Create AI job for QA
                const projectPathResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [projectId]);
                const projectPath = projectPathResult.rows[0]?.base_path;
                const qaPrompt = await buildQAPrompt(projectId, codingSessionId);
                const qaJob = await pool.query(
                  `INSERT INTO ai_jobs (project_id, provider, command, args, status)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING *`,
                  [
                    projectId,
                    'cursor',
                    'cursor',
                    JSON.stringify({
                      mode: 'agent',
                      prompt: qaPrompt,
                      project_path: projectPath,
                      qa_session_id: qaSessionId,
                    }),
                    'pending'
                  ]
                );
                
                // Update QA session to running
                await pool.query(
                  'UPDATE qa_sessions SET status = $1, started_at = $2 WHERE id = $3',
                  ['running', new Date(), qaSessionId]
                );
                
                console.log(`[Worker] QA job ${qaJob.rows[0].id} created for session ${qaSessionId}`);
              }
            } catch (qaError) {
              console.error('[Worker] Error creating QA session:', qaError);
              // Don't fail the coding session if QA creation fails
            }
          } else {
            // TDD mode: Mark session as done and execute existing test suites
            await pool.query(
              'UPDATE coding_sessions SET status = $1, implementation_progress = $2, progress = $3, completed_at = $4 WHERE id = $5',
              ['completed', 50, 100, new Date(), codingSessionId]
            );
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'completed', JSON.stringify({ message: 'Implementation completed successfully' })]
            );
            console.log(`[Worker] Coding session ${codingSessionId} completed`);

            // Clean up incorrectly placed files (move from root src/ to MVC directories)
            try {
              // Get project_id from coding session
              const sessionResult = await pool.query(
                'SELECT project_id FROM coding_sessions WHERE id = $1',
                [codingSessionId]
              );
              if (sessionResult.rows.length > 0) {
                const projectId = sessionResult.rows[0].project_id;
                const codingSessionServicePath = path.join(__dirname, '../../backend/src/services/codingSessionService');
                const { CodingSessionService } = await import(codingSessionServicePath);
                const codingSessionService = new CodingSessionService();
                const cleanupResult = await codingSessionService.cleanupIncorrectlyPlacedFiles(projectId);
                console.log(`[Worker] Cleanup result: ${cleanupResult.moved} files moved, ${cleanupResult.deleted} duplicates deleted`);
                if (cleanupResult.errors.length > 0) {
                  console.warn(`[Worker] Cleanup errors:`, cleanupResult.errors);
                }
              }
            } catch (cleanupError) {
              console.error('[Worker] Error during cleanup:', cleanupError);
              // Don't fail the session if cleanup fails
            }

            // Update breakdown task status to 'done'
            await updateBreakdownTaskStatus(codingSessionId);
            
            // Automatically execute test suites for this coding session
            try {
              await executeTestSuitesForSession(codingSessionId);
            } catch (testError) {
              console.error('[Worker] Error executing test suites:', testError);
              // Continue even if test execution fails
            }
            
            // Automatically trigger QA session
            try {
              const codingSession = await pool.query(
                'SELECT project_id FROM coding_sessions WHERE id = $1',
                [codingSessionId]
              );
              
              if (codingSession.rows.length > 0) {
                const projectId = codingSession.rows[0].project_id;
                
                // Create QA session
                const qaSession = await pool.query(
                  'INSERT INTO qa_sessions (project_id, coding_session_id, status) VALUES ($1, $2, $3) RETURNING *',
                  [projectId, codingSessionId, 'pending']
                );
                
                const qaSessionId = qaSession.rows[0].id;
                console.log(`[Worker] Created QA session ${qaSessionId} for coding session ${codingSessionId}`);
                
                // Create AI job for QA
                const projectPathResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [projectId]);
                const projectPath = projectPathResult.rows[0]?.base_path;
                const qaPrompt = await buildQAPrompt(projectId, codingSessionId);
                const qaJob = await pool.query(
                  `INSERT INTO ai_jobs (project_id, provider, command, args, status)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING *`,
                  [
                    projectId,
                    'cursor',
                    'cursor',
                    JSON.stringify({
                      mode: 'agent',
                      prompt: qaPrompt,
                      project_path: projectPath,
                      qa_session_id: qaSessionId,
                    }),
                    'pending'
                  ]
                );
                
                // Update QA session to running
                await pool.query(
                  'UPDATE qa_sessions SET status = $1, started_at = $2 WHERE id = $3',
                  ['running', new Date(), qaSessionId]
                );
                
                console.log(`[Worker] QA job ${qaJob.rows[0].id} created for session ${qaSessionId}`);
              }
            } catch (qaError) {
              console.error('[Worker] Error creating QA session:', qaError);
              // Don't fail the coding session if QA creation fails
            }
          }
        } catch (error) {
          console.error('[Worker] Error completing coding session:', error);
        }
      } else if (isTDDPhase) {
        // Handle TDD Red-Green-Refactor phases
        try {
          console.log(`[Worker] Processing TDD phase: ${phase} for session ${codingSessionId}`);
          
          // Get TDD cycle state
          const sessionResult = await pool.query(
            'SELECT tdd_cycle, project_id, story_id FROM coding_sessions WHERE id = $1',
            [codingSessionId]
          );
          
          if (sessionResult.rows.length === 0) {
            throw new Error('Coding session not found');
          }
          
          const tddCycle = sessionResult.rows[0].tdd_cycle;
          const projectId = sessionResult.rows[0].project_id;
          const storyId = sessionResult.rows[0].story_id;
          
          if (!tddCycle) {
            throw new Error('TDD cycle not initialized');
          }
          
          // Import CodingSessionService dynamically
          const codingSessionServicePath = path.join(__dirname, '../../backend/src/services/codingSessionService');
          const { CodingSessionService } = await import(codingSessionServicePath);
          const codingSessionService = new CodingSessionService();
          
          if (phase === 'tdd_green') {
            // GREEN Phase (BATCH) completed - All tests in batch should now PASS
            const batchSize = job.args.batch_size || tddCycle.batch_size || 3;
            const batchStart = job.args.batch_start !== undefined ? job.args.batch_start : tddCycle.test_index;
            const batchEnd = Math.min(batchStart + batchSize, tddCycle.total_tests);
            
            console.log(`[Worker] GREEN batch completed: tests ${batchStart + 1}-${batchEnd}/${tddCycle.total_tests}`);
            
            // Execute tests for this batch
            console.log(`[Worker] 🧪 Executing tests for batch ${batchStart + 1}-${batchEnd}...`);
            const batchTestResults = await executeBatchTests(codingSessionId, batchStart, batchSize);
            
            // Verify tests passed using actual execution results
            const testsPassed = batchTestResults.success && batchTestResults.failed === 0;
            
            if (!testsPassed) {
              console.warn(`[Worker] ⚠️ Batch tests did not pass. Results: ${batchTestResults.passed} passed, ${batchTestResults.failed} failed`);
              // Increment stuck count
              tddCycle.stuck_count = (tddCycle.stuck_count || 0) + 1;

              if (tddCycle.stuck_count >= 3) {
                // Too many failed attempts, skip to next batch
                console.error(`[Worker] ❌ Stuck on batch ${batchStart + 1}-${batchEnd} after 3 attempts. Moving to next batch.`);
                tddCycle.test_index = batchEnd;
                await pool.query(
                  `UPDATE coding_sessions SET tdd_cycle = $1::jsonb WHERE id = $2`,
                  [JSON.stringify(tddCycle), codingSessionId]
                );
                await codingSessionService.advanceToNextBatch(codingSessionId);
                return;
              }

              // ✅ INTELLIGENT RETRY: Capture failure context and use improved prompt
              console.log(`[Worker] 🔄 Intelligent retry attempt ${tddCycle.stuck_count}/3 - Capturing failure context...`);

              try {
                // 1. Capture detailed failure context
                const failureContext = await captureBatchFailureContext(
                  codingSessionId,
                  batchStart,
                  batchSize,
                  batchTestResults.output || '',
                  job.project_id
                );

                console.log(`[Worker] 📊 Failure analysis: ${failureContext.failedTests.length} tests failed, ${Object.keys(failureContext.currentImplementation).length} implementation files found`);

                // 2. Get story and session info for context
                const sessionResult = await pool.query(
                  'SELECT story_id FROM coding_sessions WHERE id = $1',
                  [codingSessionId]
                );

                if (sessionResult.rows.length === 0) {
                  console.error('[Worker] Session not found for failure correction');
                  await codingSessionService.executeBatchGREEN(codingSessionId, tddCycle);
                  return;
                }

                const storyId = sessionResult.rows[0].story_id;
                const storyResult = await pool.query(
                  'SELECT * FROM tasks WHERE id = $1',
                  [storyId]
                );

                if (storyResult.rows.length === 0) {
                  console.error('[Worker] Story not found for failure correction');
                  await codingSessionService.executeBatchGREEN(codingSessionId, tddCycle);
                  return;
                }

                const story = storyResult.rows[0];
                const batchTests = tddCycle.all_tests.slice(batchStart, batchEnd);

                // 3. Build intelligent correction prompt with full error context
                const correctionPrompt = await codingSessionService.buildFailureCorrectionPrompt(
                  job.project_id,
                  story,
                  batchTests,
                  tddCycle,
                  failureContext,
                  tddCycle.stuck_count
                );

                console.log(`[Worker] 📝 Built intelligent correction prompt with ${failureContext.failedTests.length} failure details`);

                // 4. Create AI job with improved prompt
                const correctionJob = await pool.query(
                  `INSERT INTO ai_jobs (project_id, task_id, provider, command, args, status)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   RETURNING *`,
                  [
                    job.project_id,
                    storyId,
                    'cursor',
                    'cursor',  // Provider goes in command field
                    JSON.stringify({
                      mode: 'agent',  // Mode goes in args.mode
                      prompt: correctionPrompt,
                      coding_session_id: codingSessionId,
                      phase: 'tdd_green',
                      batch_start: batchStart,
                      batch_size: batchSize,
                      attempt: tddCycle.stuck_count,
                      is_retry: true
                    }),
                    'pending'
                  ]
                );

                console.log(`[Worker] ✅ Created intelligent retry job ${correctionJob.rows[0].id} with failure context`);

                // 5. Update session with retry info
                await pool.query(
                  `UPDATE coding_sessions SET tdd_cycle = $1::jsonb WHERE id = $2`,
                  [JSON.stringify(tddCycle), codingSessionId]
                );

                // 6. Emit event for tracking
                await pool.query(
                  'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                  [codingSessionId, 'intelligent_retry', JSON.stringify({
                    batch_start: batchStart + 1,
                    batch_end: batchEnd,
                    attempt: tddCycle.stuck_count,
                    failed_tests: failureContext.failedTests.length,
                    retry_job_id: correctionJob.rows[0].id
                  })]
                );

                return;

              } catch (retryError: any) {
                console.error('[Worker] Error during intelligent retry setup:', retryError);
                console.log('[Worker] Falling back to standard retry...');
                // Fallback to standard retry if intelligent retry fails
                await codingSessionService.executeBatchGREEN(codingSessionId, tddCycle);
                return;
              }
            }
            
            // Reset stuck count on success
            tddCycle.stuck_count = 0;
            
            // Validate all_tests array exists
            if (!tddCycle.all_tests || !Array.isArray(tddCycle.all_tests)) {
              console.error('[Worker] all_tests is not an array, cannot mark batch tests as green');
              throw new Error('TDD cycle all_tests is not an array');
            }
            
            // Mark batch tests as green (with bounds checking)
            for (let i = batchStart; i < batchEnd; i++) {
              const test = tddCycle.all_tests[i];
              if (test && typeof test === 'object') {
                test.status = 'green';
              } else {
                console.warn(`[Worker] Test at index ${i} is invalid: ${typeof test}`);
              }
            }
            
            await pool.query(
              `UPDATE coding_sessions SET tdd_cycle = $1::jsonb WHERE id = $2`,
              [JSON.stringify(tddCycle), codingSessionId]
            );
            
            // Log batch completion with test statistics
            console.log(`[Worker] ✅ Batch ${batchStart + 1}-${batchEnd} completed successfully:`);
            console.log(`[Worker]   📊 Tests: ${batchTestResults.passed} passed, ${batchTestResults.failed} failed, ${batchTestResults.skipped} skipped (${batchTestResults.total} total)`);

            // Checkpoint validation: Verify test files are still in correct location
            console.log(`[Worker] 🔍 Running checkpoint validation for batch ${batchStart + 1}-${batchEnd}...`);
            try {
              const projectResult = await pool.query(
                'SELECT id FROM coding_sessions WHERE id = $1',
                [codingSessionId]
              );
              if (projectResult.rows.length > 0) {
                const sessionData = projectResult.rows[0];
                await validateGeneratedTests(codingSessionId, job.project_id);
                console.log(`[Worker] ✅ Checkpoint validation passed`);
              }
            } catch (checkpointError) {
              console.warn('[Worker] ⚠️  Checkpoint validation failed (non-blocking):', checkpointError);
              // Log as warning event but don't fail the batch
              await pool.query(
                'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
                [codingSessionId, 'error', JSON.stringify({
                  message: 'Checkpoint validation warning',
                  error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError)
                })]
              );
            }

            // Emit event for TDD cycle progress
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'tdd_cycle_progress', JSON.stringify({
                test_index: tddCycle.test_index,
                total_tests: tddCycle.total_tests,
                tests_passed: tddCycle.tests_passed || 0,
                phase: tddCycle.phase,
                refactor_count: tddCycle.refactor_count || 0,
                progress_percentage: Math.round((tddCycle.test_index / tddCycle.total_tests) * 100)
              })]
            );
            
            // Emit event for TDD batch completion
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'tdd_batch_completed', JSON.stringify({
                batch_number: Math.floor(batchStart / batchSize) + 1,
                batch_start: batchStart + 1,
                batch_end: batchEnd,
                total_tests: tddCycle.total_tests,
                tests_passed: tddCycle.tests_passed || 0,
                tests_completed: batchEnd,
                test_results: {
                  passed: batchTestResults.passed,
                  failed: batchTestResults.failed,
                  skipped: batchTestResults.skipped,
                  total: batchTestResults.total
                }
              })]
            );
            
            // Advance to next batch (includes strategic refactor logic)
            await codingSessionService.advanceToNextBatch(codingSessionId);
            
          } else if (phase === 'tdd_refactor') {
            // REFACTOR Phase completed - All tests should still PASS
            const testsCompleted = tddCycle.test_index;
            console.log(`[Worker] Strategic REFACTOR completed at ${testsCompleted}/${tddCycle.total_tests} tests`);
            
            // Validate all_tests array exists
            if (!tddCycle.all_tests || !Array.isArray(tddCycle.all_tests)) {
              console.error('[Worker] all_tests is not an array, cannot mark tests as refactored');
              throw new Error('TDD cycle all_tests is not an array');
            }
            
            // Parse output to verify all tests still pass
            const allTestsPass = result.output.toLowerCase().includes('pass') || 
                                result.output.toLowerCase().includes('✓') ||
                                !result.output.toLowerCase().includes('success');
            
            if (!allTestsPass) {
              console.warn('[Worker] Refactoring may have broken tests. Continuing anyway.');
            }
            
            // Mark refactored tests (with bounds checking)
            const maxIndex = Math.min(testsCompleted, tddCycle.all_tests.length);
            for (let i = 0; i < maxIndex; i++) {
              const test = tddCycle.all_tests[i];
              
              // Comprehensive validation before accessing properties
              if (!test) {
                console.warn(`[Worker] Test at index ${i} is undefined or null, skipping`);
                continue;
              }
              
              if (typeof test !== 'object') {
                console.warn(`[Worker] Test at index ${i} is not an object: ${typeof test}, skipping`);
                continue;
              }
              
              // Check if status property exists before accessing
              if (!('status' in test)) {
                console.warn(`[Worker] Test at index ${i} does not have status property, skipping`);
                continue;
              }
              
              // Now safe to access test.status
              if (test.status === 'green') {
                test.status = 'refactored';
              }
            }
            tddCycle.refactor_count++;
            
            await pool.query(
              `UPDATE coding_sessions SET tdd_cycle = $1::jsonb WHERE id = $2`,
              [JSON.stringify(tddCycle), codingSessionId]
            );
            
            // Emit event for TDD cycle progress after refactor
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'tdd_cycle_progress', JSON.stringify({
                test_index: tddCycle.test_index,
                total_tests: tddCycle.total_tests,
                tests_passed: tddCycle.tests_passed || 0,
                phase: tddCycle.phase,
                refactor_count: tddCycle.refactor_count || 0,
                progress_percentage: Math.round((tddCycle.test_index / tddCycle.total_tests) * 100)
              })]
            );
            
            // Continue to next batch after refactor
            await codingSessionService.advanceToNextBatch(codingSessionId);
          }
          
        } catch (error) {
          console.error(`[Worker] Error processing TDD phase ${phase}:`, error);
          await pool.query(
            'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
            ['failed', `TDD ${phase} failed: ${error}`, codingSessionId]
          );
        }
      }
      
      // Note: Architecture is saved manually by the user after reviewing the generated content
      // Auto-save removed to prevent duplicate files and allow user review before saving
      
      // Process Code Review results
      if (isCodeReview) {
        console.log(`[Worker] Processing code review for coding session ${codingSessionId}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          const reviewIteration = job.args.review_iteration || 0;
          const maxIterations = 10; // Maximum iterations to prevent infinite loops
          
          if (reviewIteration >= maxIterations) {
            console.error(`[Worker] Review reached maximum iterations (${maxIterations}), stopping`);
            await pool.query(
              'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
              ['failed', 'Review process reached maximum iterations', codingSessionId]
            );
            await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
            return;
          }

          // Get project path
          const projectResult = await pool.query(
            'SELECT base_path, tech_stack FROM projects WHERE id = $1',
            [job.project_id]
          );
          
          if (projectResult.rows.length === 0) {
            throw new Error('Project not found');
          }
          
          const projectPath = projectResult.rows[0].base_path;
          
          // Helper function to execute command and detect errors
          const executeCommand = async (command: string, args: string[] = []): Promise<{ success: boolean; output: string; errors: string[]; exitCode: number }> => {
            return new Promise((resolve) => {
              const { spawn } = require('child_process');
              const childProcess = spawn(command, args, {
                cwd: projectPath,
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
              });

              let output = '';
              let errorOutput = '';

              childProcess.stdout.on('data', (data: Buffer) => {
                output += data.toString();
              });

              childProcess.stderr.on('data', (data: Buffer) => {
                errorOutput += data.toString();
              });

              childProcess.on('close', (code: number) => {
                const errors: string[] = [];
                
                if (code !== 0) {
                  errors.push(`Command failed with exit code ${code}`);
                }

                if (errorOutput) {
                  const errorLines = errorOutput.split('\n').filter((line: string) => 
                    line.trim() && 
                    !line.includes('warning') && 
                    !line.includes('WARNING')
                  );
                  errors.push(...errorLines);
                }

                const errorPatterns = [
                  /error:/gi, /Error:/g, /ERROR:/g, /failed/gi, /Failed/gi, /FAILED/gi,
                  /exception/gi, /Exception/gi, /TypeError/gi, /ReferenceError/gi, /SyntaxError/gi,
                ];

                const outputLines = output.split('\n');
                for (const line of outputLines) {
                  for (const pattern of errorPatterns) {
                    if (pattern.test(line) && !line.includes('warning')) {
                      errors.push(line.trim());
                      break;
                    }
                  }
                }

                resolve({
                  success: code === 0 && errors.length === 0,
                  output: output + errorOutput,
                  errors: [...new Set(errors)],
                  exitCode: code || 0,
                });
              });

              childProcess.on('error', (error: Error) => {
                resolve({
                  success: false,
                  output: errorOutput,
                  errors: [error.message],
                  exitCode: -1,
                });
              });
            });
          };

          // Detect project type and get commands
          const fs = require('fs/promises');
          const path = require('path');
          
          let projectType = { type: 'unknown', buildCommand: undefined, testCommand: undefined };
          
          // Check for package.json (Node.js/TypeScript)
          try {
            const packageJsonPath = path.join(projectPath, 'package.json');
            await fs.access(packageJsonPath);
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            projectType = {
              type: 'node',
              buildCommand: packageJson.scripts?.build ? ['npm', 'run', 'build'] : undefined,
              testCommand: packageJson.scripts?.test ? ['npm', 'test'] : undefined,
            };
          } catch {
            // Check for requirements.txt (Python)
            try {
              await fs.access(path.join(projectPath, 'requirements.txt'));
              projectType = {
                type: 'python',
                testCommand: ['python', '-m', 'pytest'],
              };
            } catch {
              // Check for pom.xml (Java)
              try {
                await fs.access(path.join(projectPath, 'pom.xml'));
                projectType = {
                  type: 'java',
                  buildCommand: ['mvn', 'compile'],
                  testCommand: ['mvn', 'test'],
                };
              } catch {
                // Unknown type
              }
            }
          }
          
          console.log(`[Worker] Detected project type: ${projectType.type}`);
          
          // Initialize results with defaults
          let installResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          let buildResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          let testResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          
          // Execute build command if available
          if (projectType.buildCommand) {
            console.log(`[Worker] Executing build command: ${projectType.buildCommand.join(' ')}`);
            
            // Emit output event
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: `Building project: ${projectType.buildCommand.join(' ')}\n`,
            });
            
            buildResult = await executeCommand(
              projectType.buildCommand[0],
              projectType.buildCommand.slice(1)
            );
            
            // Emit output with results
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: buildResult.output + '\n',
            });
            
            console.log(`[Worker] Build result: success=${buildResult.success}, errors=${buildResult.errors.length}`);
          }
          
          // Execute test command if available
          if (projectType.testCommand) {
            console.log(`[Worker] Executing test command: ${projectType.testCommand.join(' ')}`);
            
            // Emit output event
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: `Running tests: ${projectType.testCommand.join(' ')}\n`,
            });
            
            testResult = await executeCommand(
              projectType.testCommand[0],
              projectType.testCommand.slice(1)
            );
            
            // Emit output with results
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: testResult.output + '\n',
            });
            
            console.log(`[Worker] Test result: success=${testResult.success}, errors=${testResult.errors.length}`);
          }
          
          // Collect all errors (include install errors for project review)
          const allErrors = [...installResult.errors, ...buildResult.errors, ...testResult.errors];
          const hasErrors = !installResult.success || !buildResult.success || !testResult.success || allErrors.length > 0;
          
          if (hasErrors) {
            console.log(`[Worker] Found ${allErrors.length} errors, creating fix job`);
            
            // Build fix prompt with error details
            const fixPrompt = `# Fix Project Errors

## Errors Found

${allErrors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

## Install Output
\`\`\`
${installResult.output.substring(0, 2000)}
\`\`\`

## Build Output
\`\`\`
${buildResult.output.substring(0, 2000)}
\`\`\`

## Test Output
\`\`\`
${testResult.output.substring(0, 2000)}
\`\`\`

## Instructions

1. Review ALL errors above
2. Fix each error in the codebase systematically
3. Ensure fixes don't break other parts of the project
4. Re-run install, build, and tests after fixes

Fix ALL errors and ensure the ENTIRE project compiles and ALL tests pass.`;

            // Create new AI job to fix errors
            const fixJob = await pool.query(
              `INSERT INTO ai_jobs (project_id, provider, command, args, status)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *`,
              [
                job.project_id,
                'cursor',
                'cursor',
                JSON.stringify({
                  mode: 'agent',
                  prompt: fixPrompt,
                  project_path: projectPath,
                  coding_session_id: codingSessionId,
                  phase: 'code_review',
                  review_iteration: reviewIteration + 1,
                }),
                'pending'
              ]
            );
            
            console.log(`[Worker] Created fix job ${fixJob.rows[0].id} for iteration ${reviewIteration + 1}`);
            
            // Update session status
            await pool.query(
              'UPDATE coding_sessions SET status = $1 WHERE id = $2',
              ['reviewing', codingSessionId]
            );
            
            // Mark current job as completed (it will trigger the fix job)
            await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
          } else {
            // No errors found, review is complete
            console.log(`[Worker] ✅ Review complete! No errors found after ${reviewIteration} iterations`);
            
            await pool.query(
              'UPDATE coding_sessions SET status = $1, completed_at = $2 WHERE id = $3',
              ['completed', new Date(), codingSessionId]
            );
            
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'completed', JSON.stringify({ 
                message: 'Review completed successfully. All errors fixed.',
                iterations: reviewIteration + 1
              })]
            );
            
            // Update breakdown task status
            await updateBreakdownTaskStatus(codingSessionId);
            
            await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
          }
        } catch (error: any) {
          console.error('[Worker] Error processing code review:', error);
          await pool.query(
            'UPDATE coding_sessions SET status = $1, error = $2 WHERE id = $3',
            ['failed', error.message, codingSessionId]
          );
          await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
        }
      }
      
      // Process Project Review results
      if (isProjectReview) {
        console.log(`[Worker] Processing project review for project ${job.project_id}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          const reviewIteration = job.args.review_iteration || 0;
          const maxIterations = 15; // Maximum iterations for project review
          
          if (reviewIteration >= maxIterations) {
            console.error(`[Worker] Project review reached maximum iterations (${maxIterations}), stopping`);
            await pool.query(
              `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
              [JSON.stringify({ status: 'failed', errors: ['Maximum iterations reached'] }), job.project_id]
            );
            await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
            return;
          }

          // Get project path
          const projectResult = await pool.query(
            'SELECT base_path, tech_stack FROM projects WHERE id = $1',
            [job.project_id]
          );
          
          if (projectResult.rows.length === 0) {
            throw new Error('Project not found');
          }
          
          const projectPath = projectResult.rows[0].base_path;
          
          // Helper function to execute command and detect errors (same as code review)
          const executeCommand = async (command: string, args: string[] = []): Promise<{ success: boolean; output: string; errors: string[]; exitCode: number }> => {
            return new Promise((resolve) => {
              const { spawn } = require('child_process');
              const childProcess = spawn(command, args, {
                cwd: projectPath,
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
              });

              let output = '';
              let errorOutput = '';

              childProcess.stdout.on('data', (data: Buffer) => {
                output += data.toString();
              });

              childProcess.stderr.on('data', (data: Buffer) => {
                errorOutput += data.toString();
              });

              childProcess.on('close', (code: number) => {
                const errors: string[] = [];
                
                if (code !== 0) {
                  errors.push(`Command failed with exit code ${code}`);
                }

                if (errorOutput) {
                  const errorLines = errorOutput.split('\n').filter((line: string) => 
                    line.trim() && 
                    !line.includes('warning') && 
                    !line.includes('WARNING')
                  );
                  errors.push(...errorLines);
                }

                const errorPatterns = [
                  /error:/gi, /Error:/g, /ERROR:/g, /failed/gi, /Failed/gi, /FAILED/gi,
                  /exception/gi, /Exception/gi, /TypeError/gi, /ReferenceError/gi, /SyntaxError/gi,
                ];

                const outputLines = output.split('\n');
                for (const line of outputLines) {
                  for (const pattern of errorPatterns) {
                    if (pattern.test(line) && !line.includes('warning')) {
                      errors.push(line.trim());
                      break;
                    }
                  }
                }

                resolve({
                  success: code === 0 && errors.length === 0,
                  output: output + errorOutput,
                  errors: [...new Set(errors)],
                  exitCode: code || 0,
                });
              });

              childProcess.on('error', (error: Error) => {
                resolve({
                  success: false,
                  output: errorOutput,
                  errors: [error.message],
                  exitCode: -1,
                });
              });
            });
          };

          // Detect project type and get commands
          const fs = require('fs/promises');
          const path = require('path');
          
          let projectType = { type: 'unknown', buildCommand: undefined, testCommand: undefined, installCommand: undefined };
          
          // Check for package.json (Node.js/TypeScript)
          try {
            const packageJsonPath = path.join(projectPath, 'package.json');
            await fs.access(packageJsonPath);
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            projectType = {
              type: 'node',
              installCommand: ['npm', 'install'],
              buildCommand: packageJson.scripts?.build ? ['npm', 'run', 'build'] : undefined,
              testCommand: packageJson.scripts?.test ? ['npm', 'test'] : undefined,
            };
          } catch {
            // Check for requirements.txt (Python)
            try {
              await fs.access(path.join(projectPath, 'requirements.txt'));
              projectType = {
                type: 'python',
                installCommand: ['pip', 'install', '-r', 'requirements.txt'],
                testCommand: ['python', '-m', 'pytest'],
              };
            } catch {
              // Check for pom.xml (Java)
              try {
                await fs.access(path.join(projectPath, 'pom.xml'));
                projectType = {
                  type: 'java',
                  buildCommand: ['mvn', 'clean', 'install'],
                  testCommand: ['mvn', 'test'],
                };
              } catch {
                // Unknown type
              }
            }
          }
          
          console.log(`[Worker] Detected project type: ${projectType.type}`);
          
          // Emit progress event and update status: Installing dependencies
          await emitProjectReviewEvent(job.project_id, {
            type: 'progress',
            step: 'Installing dependencies',
            progress: 10,
            iterations: reviewIteration,
          });
          
          await pool.query(
            `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
            [JSON.stringify({
              status: 'running',
              current_step: 'Installing dependencies',
              progress: 10,
              iterations: reviewIteration,
            }), job.project_id]
          );
          
          // Install dependencies if needed
          let installResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          if (projectType.installCommand) {
            console.log(`[Worker] Installing dependencies: ${projectType.installCommand.join(' ')}`);
            
            // Emit output event
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: `Installing dependencies: ${projectType.installCommand.join(' ')}\n`,
            });
            
            installResult = await executeCommand(
              projectType.installCommand[0],
              projectType.installCommand.slice(1)
            );
            
            // Emit output with results
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: installResult.output + '\n',
            });
            
            console.log(`[Worker] Install result: success=${installResult.success}, errors=${installResult.errors.length}`);
          }
          
          // Emit progress event and update status: Building
          await emitProjectReviewEvent(job.project_id, {
            type: 'progress',
            step: 'Building project',
            progress: 30,
            build_status: 'running',
            iterations: reviewIteration,
          });
          
          await pool.query(
            `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
            [JSON.stringify({
              status: 'running',
              current_step: 'Building project',
              progress: 30,
              build_status: 'running',
              iterations: reviewIteration,
            }), job.project_id]
          );
          
          // Execute build command if available
          let buildResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          if (projectType.buildCommand) {
            console.log(`[Worker] Executing build command: ${projectType.buildCommand.join(' ')}`);
            
            // Emit output event
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: `Building project: ${projectType.buildCommand.join(' ')}\n`,
            });
            
            buildResult = await executeCommand(
              projectType.buildCommand[0],
              projectType.buildCommand.slice(1)
            );
            
            // Emit output with results
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: buildResult.output + '\n',
            });
            
            console.log(`[Worker] Build result: success=${buildResult.success}, errors=${buildResult.errors.length}`);
          }
          
          // Emit progress event and update status: Running tests
          await emitProjectReviewEvent(job.project_id, {
            type: 'progress',
            step: 'Running tests',
            progress: 60,
            build_status: buildResult.success ? 'success' : 'failed',
            test_status: 'running',
            iterations: reviewIteration,
          });
          
          await pool.query(
            `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
            [JSON.stringify({
              status: 'running',
              current_step: 'Running tests',
              progress: 60,
              build_status: buildResult.success ? 'success' : 'failed',
              test_status: 'running',
              iterations: reviewIteration,
            }), job.project_id]
          );
          
          // Execute test command if available
          let testResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          if (projectType.testCommand) {
            console.log(`[Worker] Executing test command: ${projectType.testCommand.join(' ')}`);
            
            // Emit output event
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: `Running tests: ${projectType.testCommand.join(' ')}\n`,
            });
            
            testResult = await executeCommand(
              projectType.testCommand[0],
              projectType.testCommand.slice(1)
            );
            
            // Emit output with results
            await emitProjectReviewEvent(job.project_id, {
              type: 'output',
              content: testResult.output + '\n',
            });
            
            console.log(`[Worker] Test result: success=${testResult.success}, errors=${testResult.errors.length}`);
          }
          
          // Collect all errors and create actionable items
          const allErrors = [...installResult.errors, ...buildResult.errors, ...testResult.errors];
          const hasErrors = !installResult.success || !buildResult.success || !testResult.success || allErrors.length > 0;
          
          if (hasErrors) {
            console.log(`[Worker] Found ${allErrors.length} errors, generating actionable items`);
            
            // Parse errors and create actionable items with context
            const actionableItems = await parseErrorsIntoActionableItems(
              allErrors,
              installResult.output,
              buildResult.output,
              testResult.output,
              projectType.type,
              projectPath
            );
            
            console.log(`[Worker] Generated ${actionableItems.length} actionable items`);
            console.log(`[Worker] Actionable items:`, JSON.stringify(actionableItems, null, 2));
            
            // Update status with actionable items (waiting for user selection)
            await emitProjectReviewEvent(job.project_id, {
              type: 'progress',
              step: 'Errors detected - Review and select items to fix',
              progress: 80,
              build_status: buildResult.success ? 'success' : 'failed',
              test_status: testResult.success ? 'success' : 'failed',
              iterations: reviewIteration,
            });
            
            const reviewStatusUpdate = {
              status: 'errors_detected',
              current_step: 'Review errors and select items to fix',
              progress: 80,
              build_status: buildResult.success ? 'success' : 'failed',
              test_status: testResult.success ? 'success' : 'failed',
              errors: allErrors,
              actionable_items: actionableItems,
              install_output: installResult.output.substring(0, 5000),
              build_output: buildResult.output.substring(0, 5000),
              test_output: testResult.output.substring(0, 5000),
              iterations: reviewIteration,
            };
            
            console.log(`[Worker] Updating review status to errors_detected with ${actionableItems.length} items`);
            
            await pool.query(
              `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
              [JSON.stringify(reviewStatusUpdate), job.project_id]
            );
            
            console.log(`[Worker] ✅ Review status updated successfully`);
            
            // Mark current job as completed (no automatic fix)
            await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
          } else {
            // No errors found, review is complete
            console.log(`[Worker] ✅ Project review complete! No errors found after ${reviewIteration} iterations`);
            
            // Emit completed event
            await emitProjectReviewEvent(job.project_id, {
              type: 'completed',
              message: 'Review completed successfully! All errors fixed.',
            });
            
            await pool.query(
              `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
              [JSON.stringify({
                status: 'completed',
                progress: 100,
                build_status: 'success',
                test_status: 'success',
                iterations: reviewIteration + 1,
              }), job.project_id]
            );
            
            await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
          }
        } catch (error: any) {
          console.error('[Worker] Error processing project review:', error);
          await pool.query(
            `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
            [JSON.stringify({ status: 'failed', errors: [error.message] }), job.project_id]
          );
          await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
        }
      }
      
      // Process Project Review Fix results (fixing selected errors)
      if (isProjectReviewFix) {
        console.log(`[Worker] Processing project review fix for project ${job.project_id}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          const errorIds = job.args.error_ids || [];
          const reviewIteration = job.args.review_iteration || 0;
          
          // Get current review status
          const statusResult = await pool.query(
            `SELECT review_status FROM projects WHERE id = $1`,
            [job.project_id]
          );
          
          if (statusResult.rows.length === 0) {
            throw new Error('Project not found');
          }
          
          const currentStatus = statusResult.rows[0].review_status || {};
          const actionableItems = currentStatus.actionable_items || [];
          
          // Mark fixed items as 'fixed'
          const updatedItems = actionableItems.map((item: any) => {
            if (errorIds.includes(item.id)) {
              return { ...item, status: 'fixed' };
            }
            return item;
          });
          
          // Update status
          await pool.query(
            `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
            [JSON.stringify({
              ...currentStatus,
              status: 'running',
              current_step: 'Re-running review after fixes',
              progress: 90,
              actionable_items: updatedItems,
            }), job.project_id]
          );
          
          // Re-run review to check if errors are fixed
          const projectResult = await pool.query(
            'SELECT base_path, tech_stack FROM projects WHERE id = $1',
            [job.project_id]
          );
          
          if (projectResult.rows.length === 0) {
            throw new Error('Project not found');
          }
          
          const projectPath = projectResult.rows[0].base_path;
          
          // Helper function to execute command (same as before)
          const executeCommand = async (command: string, args: string[] = []): Promise<{ success: boolean; output: string; errors: string[]; exitCode: number }> => {
            return new Promise((resolve) => {
              const { spawn } = require('child_process');
              const childProcess = spawn(command, args, {
                cwd: projectPath,
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
              });

              let output = '';
              let errorOutput = '';

              childProcess.stdout.on('data', (data: Buffer) => {
                output += data.toString();
              });

              childProcess.stderr.on('data', (data: Buffer) => {
                errorOutput += data.toString();
              });

              childProcess.on('close', (code: number) => {
                const errors: string[] = [];
                
                if (code !== 0) {
                  errors.push(`Command failed with exit code ${code}`);
                }

                if (errorOutput) {
                  const errorLines = errorOutput.split('\n').filter((line: string) => 
                    line.trim() && 
                    !line.includes('warning') && 
                    !line.includes('WARNING')
                  );
                  errors.push(...errorLines);
                }

                const errorPatterns = [
                  /error:/gi, /Error:/g, /ERROR:/g, /failed/gi, /Failed/gi, /FAILED/gi,
                  /exception/gi, /Exception/gi, /TypeError/gi, /ReferenceError/gi, /SyntaxError/gi,
                ];

                const outputLines = output.split('\n');
                for (const line of outputLines) {
                  for (const pattern of errorPatterns) {
                    if (pattern.test(line) && !line.includes('warning')) {
                      errors.push(line.trim());
                      break;
                    }
                  }
                }

                resolve({
                  success: code === 0 && errors.length === 0,
                  output: output + errorOutput,
                  errors: [...new Set(errors)],
                  exitCode: code || 0,
                });
              });

              childProcess.on('error', (error: Error) => {
                resolve({
                  success: false,
                  output: errorOutput,
                  errors: [error.message],
                  exitCode: -1,
                });
              });
            });
          };

          // Detect project type
          const fs = require('fs/promises');
          const path = require('path');
          
          let projectType = { type: 'unknown', buildCommand: undefined, testCommand: undefined };
          
          try {
            const packageJsonPath = path.join(projectPath, 'package.json');
            await fs.access(packageJsonPath);
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            projectType = {
              type: 'node',
              buildCommand: packageJson.scripts?.build ? ['npm', 'run', 'build'] : undefined,
              testCommand: packageJson.scripts?.test ? ['npm', 'test'] : undefined,
            };
          } catch {
            try {
              await fs.access(path.join(projectPath, 'requirements.txt'));
              projectType = {
                type: 'python',
                testCommand: ['python', '-m', 'pytest'],
              };
            } catch {
              try {
                await fs.access(path.join(projectPath, 'pom.xml'));
                projectType = {
                  type: 'java',
                  buildCommand: ['mvn', 'clean', 'install'],
                  testCommand: ['mvn', 'test'],
                };
              } catch {
                // Unknown type
              }
            }
          }
          
          // Re-run build and tests
          let buildResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          if (projectType.buildCommand) {
            buildResult = await executeCommand(
              projectType.buildCommand[0],
              projectType.buildCommand.slice(1)
            );
          }
          
          let testResult = { success: true, errors: [] as string[], output: '', exitCode: 0 };
          if (projectType.testCommand) {
            testResult = await executeCommand(
              projectType.testCommand[0],
              projectType.testCommand.slice(1)
            );
          }
          
          // Check if there are still errors
          const remainingErrors = [...buildResult.errors, ...testResult.errors];
          const hasRemainingErrors = !buildResult.success || !testResult.success || remainingErrors.length > 0;
          
          if (hasRemainingErrors) {
            // Still have errors, update status back to errors_detected
            const newActionableItems = await parseErrorsIntoActionableItems(
              remainingErrors,
              '',
              buildResult.output,
              testResult.output,
              projectType.type,
              projectPath
            );
            
            await pool.query(
              `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
              [JSON.stringify({
                status: 'errors_detected',
                current_step: 'Review remaining errors',
                progress: 85,
                build_status: buildResult.success ? 'success' : 'failed',
                test_status: testResult.success ? 'success' : 'failed',
                errors: remainingErrors,
                actionable_items: [...updatedItems, ...newActionableItems],
                build_output: buildResult.output.substring(0, 5000),
                test_output: testResult.output.substring(0, 5000),
              }), job.project_id]
            );
          } else {
            // All errors fixed!
            await pool.query(
              `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
              [JSON.stringify({
                status: 'completed',
                progress: 100,
                build_status: 'success',
                test_status: 'success',
                iterations: reviewIteration + 1,
              }), job.project_id]
            );
          }
          
          await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
        } catch (error: any) {
          console.error('[Worker] Error processing project review fix:', error);
          await pool.query(
            `UPDATE projects SET review_status = $1::jsonb WHERE id = $2`,
            [JSON.stringify({ status: 'failed', errors: [error.message] }), job.project_id]
          );
          await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
        }
      }
      
      // Process Story Generation results
      if (isStoryGeneration) {
        console.log(`[Worker] Processing story generation for PRD ${prdId}`);
        console.log(`[Worker] Job success: ${result.success}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        console.log(`[Worker] Has error: ${!!result.error}`);
        
        if (!result.output || result.output.length === 0) {
          console.error('[Worker] No output received from AI for story generation');
          throw new Error('No output received from AI');
        }
        
        try {
          // Parse stories JSON from AI output
          let jsonString = '';
          let jsonMatch: RegExpMatchArray | null = null;
          
          // Try pattern 1: ```json ... ``` (most reliable)
          jsonMatch = result.output.match(/```\s*json\s*([\s\S]*?)\s*```/i);
          if (jsonMatch && jsonMatch[1]) {
            jsonString = jsonMatch[1].trim();
            console.log('[Worker] Found JSON using pattern 1 (json code block)');
          }
          
          // Try pattern 2: ``` ... ``` (code block without json label)
          if (!jsonString) {
            jsonMatch = result.output.match(/```\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) {
              const candidate = jsonMatch[1].trim();
              // Check if it looks like JSON (starts with [ or {)
              if ((candidate.startsWith('[') || candidate.startsWith('{')) && 
                  (candidate.endsWith(']') || candidate.endsWith('}'))) {
                jsonString = candidate;
                console.log('[Worker] Found JSON using pattern 2 (code block without label)');
              }
            }
          }
          
          // Try pattern 3: Direct JSON array - find balanced brackets
          if (!jsonString) {
            // Look for array starting with [ and find matching closing ]
            const jsonStart = result.output.indexOf('[');
            if (jsonStart !== -1) {
              let bracketCount = 0;
              let inString = false;
              let escapeNext = false;
              let jsonEnd = jsonStart;
              
              for (let i = jsonStart; i < result.output.length; i++) {
                const char = result.output[i];
                
                if (escapeNext) {
                  escapeNext = false;
                  continue;
                }
                
                if (char === '\\') {
                  escapeNext = true;
                  continue;
                }
                
                if (char === '"' && !escapeNext) {
                  inString = !inString;
                  continue;
                }
                
                if (!inString) {
                  if (char === '[') bracketCount++;
                  if (char === ']') {
                    bracketCount--;
                    if (bracketCount === 0) {
                      jsonEnd = i;
                      break;
                    }
                  }
                }
              }
              
              if (bracketCount === 0 && jsonEnd > jsonStart) {
                jsonString = result.output.substring(jsonStart, jsonEnd + 1).trim();
                console.log('[Worker] Found JSON using pattern 3 (balanced bracket matching)');
              }
            }
          }
          
          // Try pattern 4: Look for JSON after common explanatory prefixes (fallback)
          if (!jsonString) {
            // Sometimes AI adds text before JSON like "Here is the JSON:" or "The JSON is:"
            // Look for patterns that might indicate JSON is coming
            const jsonIndicators = [
              /json (file|array|data|content|output)/i,
              /(here|below|following|attached).*json/i,
              /contains.*user stories/i,
              /stories? (are|in|below)/i,
            ];
            
            // Find position where JSON likely starts (after explanatory text)
            let searchStart = 0;
            for (const indicator of jsonIndicators) {
              const match = result.output.match(indicator);
              if (match && match.index !== undefined) {
                searchStart = Math.max(searchStart, match.index + match[0].length);
              }
            }
            
            // Now try to find JSON starting from searchStart
            if (searchStart > 0) {
              const remainingOutput = result.output.substring(searchStart);
              const jsonStartInRemaining = remainingOutput.indexOf('[');
              if (jsonStartInRemaining !== -1) {
                const actualJsonStart = searchStart + jsonStartInRemaining;
                let bracketCount = 0;
                let inString = false;
                let escapeNext = false;
                let jsonEnd = actualJsonStart;
                
                for (let i = actualJsonStart; i < result.output.length; i++) {
                  const char = result.output[i];
                  
                  if (escapeNext) {
                    escapeNext = false;
                    continue;
                  }
                  
                  if (char === '\\') {
                    escapeNext = true;
                    continue;
                  }
                  
                  if (char === '"' && !escapeNext) {
                    inString = !inString;
                    continue;
                  }
                  
                  if (!inString) {
                    if (char === '[') bracketCount++;
                    if (char === ']') {
                      bracketCount--;
                      if (bracketCount === 0) {
                        jsonEnd = i;
                        break;
                      }
                    }
                  }
                }
                
                if (bracketCount === 0 && jsonEnd > actualJsonStart) {
                  jsonString = result.output.substring(actualJsonStart, jsonEnd + 1).trim();
                  console.log('[Worker] Found JSON using pattern 4 (after explanatory text)');
                }
              }
            }
          }
          
          if (!jsonString) {
            console.error('[Worker] No JSON found. Output preview:', result.output?.substring(0, 500));
            console.error('[Worker] Full output length:', result.output?.length);
            // Try one more time: look for ANY array-like structure
            const lastBracketMatch = result.output.match(/(\[[\s\S]{100,}\])/); // At least 100 chars to be meaningful
            if (lastBracketMatch) {
              try {
                JSON.parse(lastBracketMatch[1]);
                jsonString = lastBracketMatch[1];
                console.log('[Worker] Found JSON using pattern 5 (desperate fallback)');
              } catch (e) {
                // Still not valid JSON
              }
            }
            
            if (!jsonString) {
              throw new Error('No JSON array found in story generation output');
            }
          }
          
          // Parse JSON with better error handling
          let storiesData: any[];
          try {
            // Try to fix common JSON issues before parsing
            let cleanedJson = jsonString.trim();
            
            // If JSON doesn't start with [, try to find the array
            if (!cleanedJson.startsWith('[')) {
              const arrayStart = cleanedJson.indexOf('[');
              if (arrayStart >= 0) {
                cleanedJson = cleanedJson.substring(arrayStart);
                console.log('[Worker] 🔧 Fixed JSON: removed text before array start');
              }
            }
            
            // If JSON doesn't end with ], try to close it
            if (!cleanedJson.endsWith(']')) {
              // Count brackets to see if we need to close
              const openBrackets = (cleanedJson.match(/\[/g) || []).length;
              const closeBrackets = (cleanedJson.match(/\]/g) || []).length;
              
              if (openBrackets > closeBrackets) {
                // Try to find the last object and close it properly
                const lastBrace = cleanedJson.lastIndexOf('}');
                if (lastBrace >= 0) {
                  // Check if we need to close the object and array
                  const afterLastBrace = cleanedJson.substring(lastBrace + 1);
                  if (!afterLastBrace.includes('}') && !afterLastBrace.includes(']')) {
                    cleanedJson = cleanedJson.substring(0, lastBrace + 1) + ']';
                    console.log('[Worker] 🔧 Fixed JSON: added missing closing brackets');
                  }
                } else {
                  // No closing brace found, try to add it
                  const lastComma = cleanedJson.lastIndexOf(',');
                  if (lastComma >= 0) {
                    cleanedJson = cleanedJson.substring(0, lastComma) + '}]';
                    console.log('[Worker] 🔧 Fixed JSON: closed incomplete object and array');
                  }
                }
              }
            }
            
            storiesData = JSON.parse(cleanedJson);
            console.log(`[Worker] ✅ Successfully parsed JSON (${cleanedJson.length} chars)`);
          } catch (parseError: any) {
            console.error('[Worker] ❌ JSON parse error:', parseError.message);
            console.error('[Worker] JSON string length:', jsonString.length);
            console.error('[Worker] JSON string start:', jsonString.substring(0, 200));
            console.error('[Worker] JSON string end:', jsonString.substring(Math.max(0, jsonString.length - 200)));
            
            // Try to extract valid stories from partial JSON
            console.log('[Worker] 🔧 Attempting to extract valid stories from partial JSON...');
            try {
              // Look for complete story objects
              const storyMatches = jsonString.match(/\{[^{}]*"title"[^{}]*\}/g);
              if (storyMatches && storyMatches.length > 0) {
                const extractedStories: any[] = [];
                for (const match of storyMatches) {
                  try {
                    const story = JSON.parse(match);
                    if (story.title) {
                      extractedStories.push(story);
                    }
                  } catch (e) {
                    // Skip invalid matches
                  }
                }
                if (extractedStories.length > 0) {
                  console.log(`[Worker] ⚠️ Extracted ${extractedStories.length} valid stories from partial JSON`);
                  storiesData = extractedStories;
                } else {
                  throw parseError;
                }
              } else {
                throw parseError;
              }
            } catch (extractError) {
              throw new Error(`Failed to parse JSON: ${parseError.message}. JSON preview: ${jsonString.substring(0, 500)}`);
            }
          }
          
          if (!Array.isArray(storiesData)) {
            console.error('[Worker] Parsed data is not an array. Type:', typeof storiesData);
            console.error('[Worker] Parsed data:', JSON.stringify(storiesData, null, 2).substring(0, 500));
            throw new Error('Parsed data is not an array');
          }
          
          if (storiesData.length === 0) {
            console.warn('[Worker] Parsed array is empty. Full output:', result.output?.substring(0, 1000));
            throw new Error('Parsed array is empty - no stories generated');
          }
          
          console.log(`[Worker] ✅ Parsed ${storiesData.length} stories from AI response`);
          
          // Log first story for debugging
          if (storiesData.length > 0) {
            console.log(`[Worker] 📝 First story preview:`, JSON.stringify(storiesData[0], null, 2).substring(0, 300));
          }
          
          // Validate each story has required fields
          const validStories: any[] = [];
          for (let i = 0; i < storiesData.length; i++) {
            const story = storiesData[i];
            if (!story || typeof story !== 'object') {
              console.warn(`[Worker] ⚠️ Skipping invalid story at index ${i}: not an object`);
              continue;
            }
            if (!story.title || typeof story.title !== 'string' || story.title.trim() === '') {
              console.warn(`[Worker] ⚠️ Skipping story at index ${i}: missing or invalid title`);
              console.warn(`[Worker] Story data:`, JSON.stringify(story, null, 2).substring(0, 200));
              continue;
            }
            validStories.push(story);
          }
          
          if (validStories.length === 0) {
            console.error(`[Worker] ❌ No valid stories after validation. Original count: ${storiesData.length}`);
            console.error(`[Worker] Sample invalid story:`, JSON.stringify(storiesData[0] || {}, null, 2));
            throw new Error('No valid stories found after validation. All stories are missing required fields.');
          }
          
          if (validStories.length < storiesData.length) {
            console.warn(`[Worker] ⚠️ Filtered ${storiesData.length - validStories.length} invalid stories. ${validStories.length} valid stories remain.`);
          }
          
          storiesData = validStories;
          console.log(`[Worker] ✅ ${storiesData.length} valid stories ready to save`);
          
          // Get project_id from PRD and validate PRD exists
          const prdResult = await pool.query(
            'SELECT project_id, status FROM prd_documents WHERE id = $1',
            [prdId]
          );
          
          if (prdResult.rows.length === 0) {
            throw new Error(`PRD ${prdId} not found`);
          }
          
          const projectId = prdResult.rows[0].project_id;
          const prdStatus = prdResult.rows[0].status;
          
          // Validate project_id is not null
          if (!projectId) {
            throw new Error(`PRD ${prdId} has no project_id associated`);
          }
          
          console.log(`[Worker] 📋 PRD ${prdId} is linked to project ${projectId}`);
          
          // Validate project exists
          const projectCheck = await pool.query(
            'SELECT id, name FROM projects WHERE id = $1',
            [projectId]
          );
          
          if (projectCheck.rows.length === 0) {
            throw new Error(`Project ${projectId} not found for PRD ${prdId}`);
          }
          
          const projectName = projectCheck.rows[0].name;
          console.log(`[Worker] ✅ Project validated: ${projectId} (${projectName})`);
          console.log(`[Worker] Creating user stories for project ${projectId} from PRD ${prdId} (status: ${prdStatus})`);
          
          // Save each story to database with validation
          const savedStories: string[] = [];
          const skippedStories: string[] = [];
          let storiesWithErrors = 0;
          
          for (const storyData of storiesData) {
            try {
              // Extract fields from story data
              const title = storyData.title || '';
              const description = storyData.description || storyData.title || '';
              
              // Handle acceptance_criteria: can be array of strings or array of objects
              let acceptanceCriteria: any[] = [];
              if (storyData.acceptance_criteria) {
                if (Array.isArray(storyData.acceptance_criteria)) {
                  acceptanceCriteria = storyData.acceptance_criteria.map((ac: any) => {
                    // If it's an object with 'criterion' field, extract it
                    if (typeof ac === 'object' && ac.criterion) {
                      return ac.criterion;
                    }
                    // If it's already a string, use it
                    if (typeof ac === 'string') {
                      return ac;
                    }
                    // Fallback: stringify the object
                    return JSON.stringify(ac);
                  });
                }
              }
              
              // Validate that we have at least a title
              if (!title || title.trim() === '') {
                console.warn(`[Worker] ⚠️ Skipping story with empty title`);
                skippedStories.push('(empty title)');
                continue;
              }
              
              // Validate title is not too long (database constraint - typically 255 or 1000 chars)
              const maxTitleLength = 1000;
              if (title.length > maxTitleLength) {
                console.warn(`[Worker] ⚠️ Skipping story with title too long (${title.length} chars, max: ${maxTitleLength}): "${title.substring(0, 50)}..."`);
                skippedStories.push(title.substring(0, 50));
                continue;
              }
              
              // Validate projectId is a valid UUID
              if (!projectId || typeof projectId !== 'string' || !projectId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                console.error(`[Worker] ❌ Invalid project_id format: ${projectId}`);
                storiesWithErrors++;
                skippedStories.push(title.substring(0, 50));
                continue;
              }
              
              // Validate prdId is a valid UUID
              if (!prdId || typeof prdId !== 'string' || !prdId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                console.error(`[Worker] ❌ Invalid prd_id format: ${prdId}`);
                storiesWithErrors++;
                skippedStories.push(title.substring(0, 50));
                continue;
              }
              
              // Save story as task (type='story', no epic_id - stories are independent)
              // Check if prd_id column exists before including it in INSERT
              let insertQuery: string;
              let insertParams: any[];
              
              try {
                // Try to check if prd_id column exists
                const columnCheck = await pool.query(`
                  SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'tasks' 
                    AND column_name = 'prd_id'
                  )
                `);
                
                const hasPrdIdColumn = columnCheck.rows[0].exists;
                
                if (hasPrdIdColumn) {
                  // Include prd_id in INSERT
                  insertQuery = `INSERT INTO tasks (project_id, title, description, type, status, acceptance_criteria, generated_from_prd, priority, epic_id, prd_id)
                                 VALUES ($1, $2, $3, 'story', 'todo', $4, true, $5, NULL, $6)
                                 RETURNING id`;
                  insertParams = [
                    projectId,
                    title.trim(),
                    description || null,
                    JSON.stringify(acceptanceCriteria),
                    storyData.priority || 0,
                    prdId, // Link story to PRD for traceability
                  ];
                } else {
                  // Fallback: INSERT without prd_id (migration 014 not applied)
                  console.warn(`[Worker] ⚠️ prd_id column not found. Migration 014 may not be applied. Saving story without PRD link.`);
                  insertQuery = `INSERT INTO tasks (project_id, title, description, type, status, acceptance_criteria, generated_from_prd, priority, epic_id)
                                 VALUES ($1, $2, $3, 'story', 'todo', $4, true, $5, NULL)
                                 RETURNING id`;
                  insertParams = [
                    projectId,
                    title.trim(),
                    description || null,
                    JSON.stringify(acceptanceCriteria),
                    storyData.priority || 0,
                  ];
                }
              } catch (checkError: any) {
                // If check fails, use fallback without prd_id
                console.warn(`[Worker] ⚠️ Could not verify prd_id column. Using fallback INSERT. Error: ${checkError.message}`);
                insertQuery = `INSERT INTO tasks (project_id, title, description, type, status, acceptance_criteria, generated_from_prd, priority, epic_id)
                               VALUES ($1, $2, $3, 'story', 'todo', $4, true, $5, NULL)
                               RETURNING id`;
                insertParams = [
                  projectId,
                  title.trim(),
                  description || null,
                  JSON.stringify(acceptanceCriteria),
                  storyData.priority || 0,
                ];
              }
              
              // Log the parameters being used for debugging
              console.log(`[Worker] 🔍 Inserting story:`);
              console.log(`  - project_id: ${projectId}`);
              console.log(`  - title: "${title.substring(0, 50)}"`);
              console.log(`  - description length: ${description?.length || 0}`);
              console.log(`  - acceptance_criteria count: ${acceptanceCriteria.length}`);
              console.log(`  - priority: ${storyData.priority || 0}`);
              console.log(`  - prd_id: ${prdId || 'N/A'}`);
              console.log(`  - SQL: ${insertQuery.substring(0, 100)}...`);
              
              const storyResult = await pool.query(insertQuery, insertParams);
              
              if (!storyResult || !storyResult.rows || storyResult.rows.length === 0) {
                throw new Error('INSERT query returned no rows. Story was not saved.');
              }
              
              const storyId = storyResult.rows[0].id;
              
              // Verify the story was saved with correct project_id
              const verifyResult = await pool.query(
                'SELECT id, project_id, title, type FROM tasks WHERE id = $1',
                [storyId]
              );
              
              if (verifyResult.rows.length === 0) {
                throw new Error(`Story ${storyId} was not found after INSERT`);
              }
              
              const savedStory = verifyResult.rows[0];
              if (savedStory.project_id !== projectId) {
                console.error(`[Worker] ❌ MISMATCH: Story ${storyId} was saved with project_id ${savedStory.project_id}, expected ${projectId}`);
                throw new Error(`Project ID mismatch: saved ${savedStory.project_id}, expected ${projectId}`);
              }
              
              if (savedStory.type !== 'story') {
                console.error(`[Worker] ❌ MISMATCH: Story ${storyId} was saved with type ${savedStory.type}, expected 'story'`);
              }
              
              savedStories.push(storyId);
              console.log(`[Worker] ✅ Saved story: "${title.substring(0, 50)}..." (${storyId}) - project: ${projectId} ✅, PRD: ${prdId || 'N/A'}`);
            } catch (storyError: any) {
              const errorInfo = {
                message: storyError.message,
                code: storyError.code,
                detail: storyError.detail,
                constraint: storyError.constraint,
                table: storyError.table,
                column: storyError.column
              };
              
              console.error(`[Worker] ❌ Error saving story "${storyData.title?.substring(0, 50) || '(no title)'}":`, storyError.message);
              console.error(`[Worker] Error details:`, JSON.stringify(errorInfo, null, 2));
              console.error(`[Worker] Story data:`, JSON.stringify(storyData, null, 2).substring(0, 500));
              
              // Log specific database constraint errors
              if (storyError.code === '23505') {
                console.error(`[Worker] ⚠️ Duplicate key violation - story may already exist`);
              } else if (storyError.code === '23503') {
                console.error(`[Worker] ⚠️ Foreign key violation - referenced record may not exist`);
              } else if (storyError.code === '23502') {
                console.error(`[Worker] ⚠️ Not null violation - required field is missing`);
              } else if (storyError.code === '22001') {
                console.error(`[Worker] ⚠️ String data too long - field exceeds maximum length`);
              }
              
              storiesWithErrors++;
              skippedStories.push(storyData.title || '(error)');
            }
          }
          
          // Validate integrity: Check that all saved stories are properly linked
          if (savedStories.length > 0) {
            const integrityCheck = await pool.query(
              `SELECT id, title, type, project_id, epic_id 
               FROM tasks 
               WHERE id = ANY($1::uuid[])`,
              [savedStories]
            );
            
            const orphanedStories = integrityCheck.rows.filter((s: any) => 
              s.project_id !== projectId || s.type !== 'story' || s.epic_id !== null
            );
            
            if (orphanedStories.length > 0) {
              console.error(`[Worker] ❌ Found ${orphanedStories.length} stories with integrity issues:`, 
                orphanedStories.map((s: any) => `${s.title} (project: ${s.project_id}, type: ${s.type}, epic_id: ${s.epic_id})`));
            }
          }
          
          console.log(`[Worker] Story generation summary: ${savedStories.length} stories saved, ${skippedStories.length} skipped, ${storiesWithErrors} errors`);
          
          if (savedStories.length === 0) {
            // Provide detailed error information
            const errorDetails = [];
            if (storiesData.length === 0) {
              errorDetails.push('No stories were generated from AI');
            } else {
              errorDetails.push(`${storiesData.length} stories were generated but none were saved`);
            }
            if (skippedStories.length > 0) {
              errorDetails.push(`${skippedStories.length} stories were skipped: ${skippedStories.slice(0, 5).join(', ')}${skippedStories.length > 5 ? '...' : ''}`);
            }
            if (storiesWithErrors > 0) {
              errorDetails.push(`${storiesWithErrors} stories had errors during save`);
            }
            
            const errorMessage = `No stories were successfully saved to the database. ${errorDetails.join('. ')}`;
            console.error(`[Worker] ${errorMessage}`);
            throw new Error(errorMessage);
          }
          
          // Save stories to filesystem
          try {
            const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [projectId]);
            if (projectResult.rows.length > 0) {
              const projectBasePath = projectResult.rows[0].base_path;
              const storiesDir = path.join(projectBasePath, 'docs', 'user-stories', projectId);
              await fs.mkdir(storiesDir, { recursive: true });
              
              // Save as JSON
              const jsonPath = path.join(storiesDir, 'stories.json');
              await fs.writeFile(jsonPath, jsonString, 'utf8');
              
              console.log(`[Worker] Saved stories to ${jsonPath}`);
            }
          } catch (fsError) {
            console.error('[Worker] Error saving stories to filesystem:', fsError);
            // Don't fail the job if filesystem save fails
          }
          
        } catch (error: any) {
          console.error('[Worker] Error processing story generation:', error);
          console.error('[Worker] Full output:', result.output?.substring(0, 1000));
          // Mark job as failed so user knows something went wrong
          await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
          await jobRepo.addEvent(jobId, 'failed', { 
            error: error.message || String(error),
            output_preview: result.output?.substring(0, 500)
          });
          throw error; // Re-throw to mark job as failed
        }
      } else {
        // Job succeeded but not a story generation job - check if it's architecture
        // Architecture jobs don't have a phase, they're just plan mode jobs
        // The architecture is saved manually by the user, but we should ensure the output is available
        if (mode === 'plan' && !isCodingSession && !isStoryGeneration && !isRFCGeneration && !isBreakdownGeneration && !isUserFlowGeneration && !isPrototypeAnalysis && !isQASession) {
          // This is likely an architecture generation job
          console.log(`[Worker] Architecture generation completed. Output available in job ${jobId}.`);
          console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
          // Architecture is saved manually by user, so we just log completion
        }
      }
      
      // Process RFC Generation results
      if (isRFCGeneration) {
        console.log(`[Worker] Processing RFC generation`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          // Get RFC ID from job args (it was stored when RFC was created)
          const rfcIdFromArgs = job.args.rfc_id;
          if (!rfcIdFromArgs) {
            // Try to find RFC by project_id and prd_id
            const prdIdFromArgs = job.args.prd_id;
            if (prdIdFromArgs) {
              const prdResult = await pool.query(
                'SELECT project_id FROM prd_documents WHERE id = $1',
                [prdIdFromArgs]
              );
              if (prdResult.rows.length > 0) {
                const projectId = prdResult.rows[0].project_id;
                const rfcResult = await pool.query(
                  'SELECT id FROM rfc_documents WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
                  [projectId]
                );
                if (rfcResult.rows.length > 0) {
                  const foundRfcId = rfcResult.rows[0].id;
                  
                  // Update RFC with generated content
                  await pool.query(
                    'UPDATE rfc_documents SET content = $1, status = $2, updated_at = NOW() WHERE id = $3',
                    [result.output, 'draft', foundRfcId]
                  );
                  
                  // Save to filesystem
                  const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [projectId]);
                  if (projectResult.rows.length > 0) {
                    const projectBasePath = projectResult.rows[0].base_path;
                    const rfcDir = path.join(projectBasePath, 'docs', 'rfc', projectId);
                    await fs.mkdir(rfcDir, { recursive: true });
                    
                    const rfcPath = path.join(rfcDir, `rfc-${foundRfcId}.md`);
                    await fs.writeFile(rfcPath, result.output, 'utf8');
                    console.log(`[Worker] Saved RFC to ${rfcPath}`);
                  }
                  
                  console.log(`[Worker] RFC ${foundRfcId} updated with generated content`);
                }
              }
            }
          } else {
            // Update RFC with generated content
            await pool.query(
              'UPDATE rfc_documents SET content = $1, status = $2, updated_at = NOW() WHERE id = $3',
              [result.output, 'draft', rfcIdFromArgs]
            );
            
            // Get project_id for filesystem save
            const rfcResult = await pool.query('SELECT project_id FROM rfc_documents WHERE id = $1', [rfcIdFromArgs]);
            if (rfcResult.rows.length > 0) {
              const projectId = rfcResult.rows[0].project_id;
              const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [projectId]);
              if (projectResult.rows.length > 0) {
                const projectBasePath = projectResult.rows[0].base_path;
                const rfcDir = path.join(projectBasePath, 'docs', 'rfc', projectId);
                await fs.mkdir(rfcDir, { recursive: true });
                
                const rfcPath = path.join(rfcDir, `rfc-${rfcIdFromArgs}.md`);
                await fs.writeFile(rfcPath, result.output, 'utf8');
                console.log(`[Worker] Saved RFC to ${rfcPath}`);
              }
            }
            
            console.log(`[Worker] RFC ${rfcIdFromArgs} updated with generated content`);
          }
          
          // TODO: Parse and extract API contracts and database schemas if they were requested
          // This would require parsing the markdown to find code blocks with JSON/SQL
          
        } catch (error: any) {
          console.error('[Worker] Error processing RFC generation:', error);
          console.error('[Worker] Full output preview:', result.output?.substring(0, 1000));
        }
      }
      
      // Process Breakdown Generation results
      if (isBreakdownGeneration) {
        console.log(`[Worker] Processing breakdown generation for RFC ${rfcId}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          const rfcIdFromArgs = job.args.rfc_id;
          const maxDaysPerTask = job.args.max_days_per_task || 3;
          const estimateStoryPoints = job.args.estimate_story_points !== false;
          
          if (!rfcIdFromArgs) {
            throw new Error('RFC ID not found in job args');
          }

          // Parse breakdown JSON from AI response
          let jsonString = '';
          let jsonMatch: RegExpMatchArray | null = null;
          
          // Try pattern 1: ```json ... ```
          jsonMatch = result.output.match(/```\s*json\s*(\{[\s\S]*?\})\s*```/i);
          if (jsonMatch && jsonMatch[1]) {
            jsonString = jsonMatch[1].trim();
            console.log('[Worker] Found JSON using pattern 1 (json code block)');
          }
          
          // Try pattern 2: Direct JSON object
          if (!jsonString) {
            jsonMatch = result.output.match(/\{[\s\S]*\}/);
            if (jsonMatch && jsonMatch[0]) {
              jsonString = jsonMatch[0].trim();
              console.log('[Worker] Found JSON using pattern 2 (direct object)');
            }
          }
          
          if (!jsonString) {
            throw new Error('No JSON object found in breakdown generation output');
          }
          
          // Parse JSON
          const breakdownData = JSON.parse(jsonString);
          if (!breakdownData.epics || !Array.isArray(breakdownData.epics)) {
            throw new Error('Invalid breakdown: epics array missing');
          }
          if (!breakdownData.tasks || !Array.isArray(breakdownData.tasks)) {
            throw new Error('Invalid breakdown: tasks array missing');
          }
          
          // Validate tasks don't exceed max days
          const invalidTasks = breakdownData.tasks.filter((t: any) => 
            t.estimated_days && t.estimated_days > maxDaysPerTask
          );
          if (invalidTasks.length > 0) {
            console.warn(`[Worker] Warning: ${invalidTasks.length} tasks exceed ${maxDaysPerTask} days:`, 
              invalidTasks.map((t: any) => `${t.title} (${t.estimated_days} days)`));
            // Continue anyway but log warning
          }
          
          console.log(`[Worker] Parsed ${breakdownData.epics.length} epics and ${breakdownData.tasks.length} tasks`);
          
          // Get project_id from RFC
          const rfcResult = await pool.query('SELECT project_id FROM rfc_documents WHERE id = $1', [rfcIdFromArgs]);
          if (rfcResult.rows.length === 0) {
            throw new Error('RFC not found');
          }
          const projectId = rfcResult.rows[0].project_id;
          
          // Validate RFC exists and belongs to project
          const rfcCheck = await pool.query(
            'SELECT id, project_id FROM rfc_documents WHERE id = $1 AND project_id = $2',
            [rfcIdFromArgs, projectId]
          );
          if (rfcCheck.rows.length === 0) {
            throw new Error(`RFC ${rfcIdFromArgs} not found or doesn't belong to project ${projectId}`);
          }
          
          // Create épicas with validation
          const epicIdMap = new Map<string, string>(); // epic_title -> epic_id
          const createdEpicIds: string[] = [];
          
          for (const epicData of breakdownData.epics) {
            if (!epicData.title || epicData.title.trim() === '') {
              console.warn(`[Worker] Skipping epic with empty title`);
              continue;
            }
            
            try {
              const epicResult = await pool.query(
                `INSERT INTO epics (project_id, rfc_id, title, description, story_points, order_index, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'planned')
                 RETURNING id`,
                [
                  projectId,
                  rfcIdFromArgs,
                  epicData.title.trim(),
                  epicData.description || null,
                  epicData.story_points || null,
                  epicData.order_index || null,
                ]
              );
              
              const epicId = epicResult.rows[0].id;
              epicIdMap.set(epicData.title.trim(), epicId);
              createdEpicIds.push(epicId);
              console.log(`[Worker] ✅ Created epic: "${epicData.title}" (${epicId}) linked to RFC ${rfcIdFromArgs}`);
            } catch (epicError: any) {
              console.error(`[Worker] ❌ Error creating epic "${epicData.title}":`, epicError.message);
              // Continue with next epic, but log the error
            }
          }
          
          if (epicIdMap.size === 0) {
            throw new Error('No epics were created successfully. Cannot create tasks without epics.');
          }
          
          // Create tasks with validation
          let tasksCreated = 0;
          let tasksSkipped = 0;
          const orphanedTasks: string[] = [];
          
          for (const taskData of breakdownData.tasks) {
            if (!taskData.title || taskData.title.trim() === '') {
              console.warn(`[Worker] ⚠️ Skipping task with empty title`);
              tasksSkipped++;
              continue;
            }
            
            const epicId = epicIdMap.get(taskData.epic_title);
            if (!epicId) {
              console.error(`[Worker] ❌ Epic "${taskData.epic_title}" not found for task "${taskData.title}". Available epics: ${Array.from(epicIdMap.keys()).join(', ')}`);
              orphanedTasks.push(taskData.title);
              tasksSkipped++;
              continue;
            }
            
            // Ensure estimated_days doesn't exceed max and convert to integer
            // Convert decimal values (e.g., 0.5, 1.5) to integers by rounding up
            let estimatedDays: number | null = null;
            if (taskData.estimated_days != null && !isNaN(taskData.estimated_days)) {
              const rawDays = parseFloat(taskData.estimated_days);
              if (!isNaN(rawDays) && rawDays > 0) {
                // Round up to nearest integer (0.5 -> 1, 1.5 -> 2, etc.)
                estimatedDays = Math.min(Math.ceil(rawDays), maxDaysPerTask);
              }
            }
            // Default to 3 if not provided or invalid
            if (estimatedDays === null || estimatedDays <= 0) {
              estimatedDays = 3;
            }
            
            const acceptanceCriteria = taskData.acceptance_criteria || [];
            
            try {
              const taskResult = await pool.query(
                `INSERT INTO tasks (project_id, title, description, type, status, epic_id, estimated_days, story_points, breakdown_order, acceptance_criteria, priority)
                 VALUES ($1, $2, $3, 'task', 'todo', $4, $5, $6, $7, $8, 0)
                 RETURNING id`,
                [
                  projectId,
                  taskData.title.trim(),
                  taskData.description || null,
                  epicId,
                  estimatedDays,
                  taskData.story_points || null,
                  taskData.breakdown_order || null,
                  JSON.stringify(acceptanceCriteria),
                ]
              );
              
              tasksCreated++;
              console.log(`[Worker] ✅ Created task: "${taskData.title}" (${taskResult.rows[0].id}) linked to epic "${taskData.epic_title}" (${epicId})`);
            } catch (taskError: any) {
              console.error(`[Worker] ❌ Error creating task "${taskData.title}":`, taskError.message);
              tasksSkipped++;
            }
          }
          
          // Validate integrity: Check for orphaned records
          const orphanedEpics = await pool.query(
            'SELECT id, title FROM epics WHERE rfc_id = $1 AND id NOT IN (SELECT DISTINCT epic_id FROM tasks WHERE epic_id IS NOT NULL)',
            [rfcIdFromArgs]
          );
          
          if (orphanedEpics.rows.length > 0) {
            console.warn(`[Worker] ⚠️ Found ${orphanedEpics.rows.length} epics without tasks:`, 
              orphanedEpics.rows.map((e: any) => e.title).join(', '));
          }
          
          if (orphanedTasks.length > 0) {
            console.error(`[Worker] ❌ ${orphanedTasks.length} tasks could not be created due to missing epics:`, orphanedTasks.join(', '));
          }
          
          console.log(`[Worker] Breakdown summary: ${epicIdMap.size} epics created, ${tasksCreated} tasks created, ${tasksSkipped} tasks skipped`);
          
          // If no tasks were created but epics exist, warn about potential orphaned epics
          if (tasksCreated === 0 && epicIdMap.size > 0) {
            console.error(`[Worker] ⚠️ WARNING: Created ${epicIdMap.size} epics but no tasks. Epics may be orphaned.`);
          }
          
        } catch (error: any) {
          console.error('[Worker] Error processing breakdown generation:', error);
          console.error('[Worker] Full output preview:', result.output?.substring(0, 1000));
        }
      }
      
      // Process User Flow Generation results
      if (isUserFlowGeneration) {
        console.log(`[Worker] Processing user flow generation for user flow ${userFlowId}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          if (!userFlowId) {
            throw new Error('User flow ID not found in job args');
          }

          // Extract Mermaid diagram from output
          let mermaidDiagram = '';
          
          // Pattern 1: Code block with mermaid
          const mermaidMatch = result.output.match(/```\s*mermaid\s*([\s\S]*?)\s*```/i);
          if (mermaidMatch && mermaidMatch[1]) {
            mermaidDiagram = mermaidMatch[1].trim();
            console.log('[Worker] Found Mermaid diagram using pattern 1 (mermaid code block)');
          } else {
            // Pattern 2: Direct mermaid content (might start with flowchart, graph, sequenceDiagram, etc.)
            const directMatch = result.output.match(/(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|gantt|pie|gitgraph|journey)[\s\S]*/i);
            if (directMatch && directMatch[0]) {
              mermaidDiagram = directMatch[0].trim();
              console.log('[Worker] Found Mermaid diagram using pattern 2 (direct content)');
            } else {
              // Fallback: use the entire output
              mermaidDiagram = result.output.trim();
              console.log('[Worker] Using entire output as Mermaid diagram');
            }
          }

          if (!mermaidDiagram) {
            throw new Error('No Mermaid diagram found in user flow generation output');
          }

          // Update user flow with diagram
          await pool.query(
            `UPDATE user_flows SET flow_diagram = $1, updated_at = NOW() WHERE id = $2`,
            [mermaidDiagram, userFlowId]
          );
          
          console.log(`[Worker] Updated user flow ${userFlowId} with Mermaid diagram (${mermaidDiagram.length} chars)`);
          
        } catch (error: any) {
          console.error('[Worker] Error processing user flow generation:', error);
          console.error('[Worker] Full output preview:', result.output?.substring(0, 1000));
        }
      }

      // Process Prototype Analysis results
      if (isPrototypeAnalysis) {
        console.log(`[Worker] Processing prototype analysis for prototype ${prototypeId}`);
        console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
        
        try {
          if (!prototypeId) {
            throw new Error('Prototype ID not found in job args');
          }

          // Extract JSON from output
          let jsonString = '';
          
          // Pattern 1: Code block with json
          const jsonBlockMatch = result.output.match(/```\s*json\s*(\{[\s\S]*?\})\s*```/i);
          if (jsonBlockMatch && jsonBlockMatch[1]) {
            jsonString = jsonBlockMatch[1].trim();
            console.log('[Worker] Found JSON using pattern 1 (json code block)');
          } else {
            // Pattern 2: Direct JSON object
            const objectMatch = result.output.match(/\{[\s\S]*\}/);
            if (objectMatch && objectMatch[0]) {
              jsonString = objectMatch[0].trim();
              console.log('[Worker] Found JSON using pattern 2 (direct object)');
            }
          }

          if (!jsonString) {
            throw new Error('No JSON object found in prototype analysis output');
          }

          // Parse and validate JSON
          const analysisResult = JSON.parse(jsonString);
          
          // Validate structure
          if (!analysisResult.elements && !analysisResult.flows && !analysisResult.insights) {
            console.warn('[Worker] Warning: Analysis result missing expected fields (elements, flows, insights)');
          }

          // Update prototype with analysis
          await pool.query(
            `UPDATE prototypes SET analysis_result = $1 WHERE id = $2`,
            [JSON.stringify(analysisResult), prototypeId]
          );
          
          console.log(`[Worker] Updated prototype ${prototypeId} with analysis result`);
          
        } catch (error: any) {
          console.error('[Worker] Error processing prototype analysis:', error);
          console.error('[Worker] Full output preview:', result.output?.substring(0, 1000));
        }
      }
      
      // Process QA results
      if (isQASession) {
        console.log(`[Worker] Processing QA session ${qaSessionId}, phase: ${job.args.phase || 'execution'}`);
        try {
          const qaPhase = job.args.phase; // 'test_generation', 'integration_test_plan_generation', or undefined (run tests)
          
          // Handle test plan generation (for all test types)
          if (qaPhase === 'test_plan_generation') {
            const testType = job.args?.test_type || 'unit';
            console.log(`[Worker] Processing ${testType} test plan generation for QA session ${qaSessionId}`);
            console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
            
            // Parse plan from AI output - try multiple patterns
            let jsonMatch: RegExpMatchArray | null = null;
            let jsonString = '';
            
            // Try pattern 1: ```json ... ``` (flexible whitespace, non-greedy to get first match)
            jsonMatch = result.output.match(/```\s*json\s*([\s\S]*?)\s*```/i);
            if (jsonMatch && jsonMatch[1]) {
              jsonString = jsonMatch[1].trim();
              console.log('[Worker] Found JSON using pattern 1 (json code block)');
            }
            
            // Try pattern 1b: Look for JSON after "```json" even if there's text before it
            if (!jsonString) {
              const jsonBlockIndex = result.output.toLowerCase().indexOf('```json');
              if (jsonBlockIndex !== -1) {
                const afterJsonBlock = result.output.substring(jsonBlockIndex);
                jsonMatch = afterJsonBlock.match(/```\s*json\s*([\s\S]*?)\s*```/i);
                if (jsonMatch && jsonMatch[1]) {
                  jsonString = jsonMatch[1].trim();
                  console.log('[Worker] Found JSON using pattern 1b (json code block after text)');
                }
              }
            }
            
            // Try pattern 2: ``` ... ``` (without json, but contains array)
            if (!jsonString) {
              jsonMatch = result.output.match(/```\s*([\s\S]*?)\s*```/);
              if (jsonMatch && jsonMatch[1]) {
                // Check if it looks like JSON array
                const candidate = jsonMatch[1].trim();
                if ((candidate.startsWith('[') || candidate.startsWith('{')) && candidate.includes('[')) {
                  // Try to extract just the array part
                  const arrayStart = candidate.indexOf('[');
                  const arrayEnd = candidate.lastIndexOf(']');
                  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
                    const arrayCandidate = candidate.substring(arrayStart, arrayEnd + 1);
                    try {
                      const parsed = JSON.parse(arrayCandidate);
                      if (Array.isArray(parsed)) {
                        jsonString = arrayCandidate;
                        console.log('[Worker] Found JSON using pattern 2 (code block with array)');
                      }
                    } catch {
                      // Not valid, continue
                    }
                  }
                }
              }
            }
            
            // Try pattern 3: Find JSON array directly in text
            if (!jsonString) {
              jsonMatch = result.output.match(/\[\s*\{[\s\S]*?\}\s*\]/);
              if (jsonMatch && jsonMatch[0]) {
                jsonString = jsonMatch[0].trim();
              }
            }
            
            // Try pattern 4: Find JSON by looking for [ and ]
            if (!jsonString) {
              const jsonStart = result.output.indexOf('[');
              const jsonEnd = result.output.lastIndexOf(']');
              if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const candidate = result.output.substring(jsonStart, jsonEnd + 1).trim();
                // Validate it looks like JSON
                if (candidate.startsWith('[') && candidate.endsWith(']')) {
                  jsonString = candidate;
                }
              }
            }
            
            // Try pattern 5: Look for JSON after common markers
            if (!jsonString) {
              const markers = ['Output:', 'Plan:', 'Tests:', 'JSON:', 'Result:', 'Test Plan:', 'Here is', 'Here\'s', 'created', 'generated'];
              for (const marker of markers) {
                const markerIndex = result.output.toLowerCase().indexOf(marker.toLowerCase());
                if (markerIndex !== -1) {
                  const afterMarker = result.output.substring(markerIndex + marker.length);
                  const jsonStart = afterMarker.indexOf('[');
                  const jsonEnd = afterMarker.lastIndexOf(']');
                  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                    const candidate = afterMarker.substring(jsonStart, jsonEnd + 1).trim();
                    if (candidate.startsWith('[') && candidate.endsWith(']')) {
                      jsonString = candidate;
                      console.log(`[Worker] Found JSON using pattern 5 (after marker: ${marker})`);
                      break;
                    }
                  }
                }
              }
            }
            
            // Try pattern 5b: Look for JSON after file mentions (e.g., "I've created file.json with...")
            if (!jsonString) {
              const filePattern = /(?:created|generated|saved|wrote|made)\s+[^\s]+\.json[^[]*\[/i;
              const fileMatch = result.output.match(filePattern);
              if (fileMatch) {
                const afterFileMention = result.output.substring(fileMatch.index! + fileMatch[0].length - 1);
                const jsonEnd = afterFileMention.lastIndexOf(']');
                if (jsonEnd !== -1) {
                  const candidate = '[' + afterFileMention.substring(0, jsonEnd + 1);
                  try {
                    const parsed = JSON.parse(candidate);
                    if (Array.isArray(parsed)) {
                      jsonString = candidate;
                      console.log('[Worker] Found JSON using pattern 5b (after file mention)');
                    }
                  } catch {
                    // Not valid JSON, continue
                  }
                }
              }
            }
            
            // Try pattern 6: Extract JSON from lines that look like JSON (more aggressive)
            if (!jsonString) {
              const lines = result.output.split('\n');
              let jsonLines: string[] = [];
              let inJsonBlock = false;
              let braceCount = 0;
              let bracketCount = 0;
              
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                // Count brackets and braces to track JSON structure
                const openBrackets = (line.match(/\[/g) || []).length;
                const closeBrackets = (line.match(/\]/g) || []).length;
                const openBraces = (line.match(/\{/g) || []).length;
                const closeBraces = (line.match(/\}/g) || []).length;
                
                // Start of JSON array
                if (!inJsonBlock && (trimmed.startsWith('[') || (openBrackets > 0 && trimmed.match(/^\s*\[/)))) {
                  inJsonBlock = true;
                  jsonLines = [line];
                  bracketCount = openBrackets - closeBrackets;
                  braceCount = openBraces - closeBraces;
                } else if (inJsonBlock) {
                  jsonLines.push(line);
                  bracketCount += openBrackets - closeBrackets;
                  braceCount += openBraces - closeBraces;
                  
                  // End of JSON array (balanced brackets and braces)
                  if (bracketCount === 0 && braceCount === 0 && (trimmed.endsWith(']') || closeBrackets > 0)) {
                    const candidate = jsonLines.join('\n').trim();
                    // Clean up: remove any trailing text after ]
                    const cleanCandidate = candidate.replace(/\]\s*[^\]]*$/, ']');
                    if (cleanCandidate.startsWith('[') && cleanCandidate.endsWith(']')) {
                      try {
                        // Validate it's valid JSON
                        const parsed = JSON.parse(cleanCandidate);
                        if (Array.isArray(parsed)) {
                          jsonString = cleanCandidate;
                          break;
                        }
                      } catch {
                        // Not valid JSON, continue searching
                        inJsonBlock = false;
                        jsonLines = [];
                        bracketCount = 0;
                        braceCount = 0;
                      }
                    }
                  }
                }
              }
            }
            
            if (!jsonString) {
              // Log the full output for debugging
              console.error(`[Worker] ========== FULL OUTPUT START ==========`);
              console.error(result.output);
              console.error(`[Worker] ========== FULL OUTPUT END ==========`);
              console.error(`[Worker] Output length: ${result.output?.length || 0} characters`);
              
              // Try one more pattern: look for any valid JSON array anywhere (character-by-character)
              try {
                const output = result.output || '';
                let bestCandidate: { json: string; length: number } | null = null;
                
                // Find all potential JSON arrays
                for (let start = 0; start < output.length; start++) {
                  if (output[start] === '[') {
                    // Try to find matching closing bracket with proper nesting
                    let bracketDepth = 0;
                    let braceDepth = 0;
                    let inString = false;
                    let escapeNext = false;
                    let end = -1;
                    
                    for (let i = start; i < output.length; i++) {
                      const char = output[i];
                      
                      if (escapeNext) {
                        escapeNext = false;
                        continue;
                      }
                      
                      if (char === '\\') {
                        escapeNext = true;
                        continue;
                      }
                      
                      if (char === '"' && !escapeNext) {
                        inString = !inString;
                        continue;
                      }
                      
                      if (!inString) {
                        if (char === '[') bracketDepth++;
                        if (char === ']') bracketDepth--;
                        if (char === '{') braceDepth++;
                        if (char === '}') braceDepth--;
                        
                        if (bracketDepth === 0 && braceDepth === 0 && i > start) {
                          end = i;
                          break;
                        }
                      }
                    }
                    
                    if (end > start) {
                      const candidate = output.substring(start, end + 1);
                      try {
                        const parsed = JSON.parse(candidate);
                        if (Array.isArray(parsed)) {
                          // Prefer longer arrays (more complete)
                          if (!bestCandidate || parsed.length > bestCandidate.length) {
                            bestCandidate = { json: candidate, length: parsed.length };
                          }
                        }
                      } catch {
                        // Not valid JSON, continue
                      }
                    }
                  }
                }
                
                if (bestCandidate) {
                  jsonString = bestCandidate.json;
                  console.log(`[Worker] Found JSON array using fallback pattern (${bestCandidate.length} items)`);
                }
              } catch (e) {
                console.error(`[Worker] Fallback pattern search failed:`, e);
              }
              
              if (!jsonString) {
                throw new Error('No JSON array found in test plan output');
              }
            }

            let planItems;
            try {
              planItems = JSON.parse(jsonString);
            } catch (parseError: any) {
              console.error(`[Worker] JSON parse error: ${parseError.message}`);
              console.error(`[Worker] JSON string (first 500 chars): ${jsonString.substring(0, 500)}`);
              console.error(`[Worker] JSON string (last 500 chars): ${jsonString.substring(Math.max(0, jsonString.length - 500))}`);
              throw new Error(`Failed to parse JSON: ${parseError.message}`);
            }
            
            if (!Array.isArray(planItems)) {
              console.error(`[Worker] Parsed result is not an array. Type: ${typeof planItems}, Value: ${JSON.stringify(planItems).substring(0, 200)}`);
              throw new Error('Test plan must be a JSON array');
            }
            
            if (planItems.length === 0) {
              console.warn(`[Worker] Parsed plan has 0 items. This might be expected, but usually plans should have items.`);
            } else {
              console.log(`[Worker] Successfully parsed ${planItems.length} test plan items`);
            }

            // Find or create the plan
            const planResult = await pool.query(
              'SELECT id FROM test_plans WHERE qa_session_id = $1 AND test_type = $2 ORDER BY created_at DESC LIMIT 1',
              [qaSessionId, testType]
            );

            if (planResult.rows.length > 0) {
              // Update existing plan
              await pool.query(
                'UPDATE test_plans SET items = $1, status = $2 WHERE id = $3',
                [JSON.stringify(planItems), 'draft', planResult.rows[0].id]
              );
              console.log(`[Worker] Updated ${testType} test plan with ${planItems.length} items`);
            } else {
              // Create new plan if not found
              const sessionResult = await pool.query(
                'SELECT project_id, coding_session_id FROM qa_sessions WHERE id = $1',
                [qaSessionId]
              );
              
              if (sessionResult.rows.length > 0) {
                const session = sessionResult.rows[0];
                await pool.query(
                  `INSERT INTO test_plans (project_id, qa_session_id, coding_session_id, test_type, items, status)
                   VALUES ($1, $2, $3, $4, $5, $6)`,
                  [session.project_id, qaSessionId, session.coding_session_id, testType, JSON.stringify(planItems), 'draft']
                );
                console.log(`[Worker] Created ${testType} test plan with ${planItems.length} items`);
              }
            }

            // Update QA session status to pending (waiting for user approval)
            await pool.query(
              'UPDATE qa_sessions SET status = $1, completed_at = $2 WHERE id = $3',
              ['pending', new Date(), qaSessionId]
            );
          } else if (qaPhase === 'test_generation') {
            console.log(`[Worker] Processing test generation for QA session ${qaSessionId}`);
            const storyId = job.args.story_id;
            const storyIndex = job.args.story_index || 0;
            const totalStories = job.args.total_stories || 1;
            
            // This is test generation only - save test code per functionality
            const jsonMatch = result.output.match(/```json\s*([\s\S]*?)\s*```/) || 
                             result.output.match(/\{[\s\S]*\}/);
            
            let testCode = '';
            let testData: any = null;
            
            if (jsonMatch) {
              try {
                testData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                testCode = testData.test_code || result.output;
              } catch (e) {
                testCode = result.output;
              }
            } else {
              testCode = result.output;
            }
            
            // Save test code to file (append or create per story)
            const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [job.project_id]);
            if (projectResult.rows.length > 0) {
              const project = projectResult.rows[0];
              const testDir = path.join(project.base_path, 'docs', `TESTS_${qaSessionId}`);
              await fs.mkdir(testDir, { recursive: true });
              
              // Save individual test file for this story
              const storyFileName = storyId 
                ? `test_story_${storyId}_${storyIndex}.js`
                : `test_general_${storyIndex}.js`;
              const testFilePath = path.join(testDir, storyFileName);
              await fs.writeFile(testFilePath, testCode, 'utf8');
              
              // Store test file info in database (we'll use a JSON field or separate table)
              // For now, append to a consolidated file
              const consolidatedPath = path.join(testDir, 'all_tests.js');
              const separator = `\n\n// ===== Tests for Story ${storyIndex + 1}/${totalStories} =====\n\n`;
              
              try {
                const existingContent = await fs.readFile(consolidatedPath, 'utf8').catch(() => '');
                await fs.writeFile(consolidatedPath, existingContent + separator + testCode, 'utf8');
              } catch (e) {
                await fs.writeFile(consolidatedPath, separator + testCode, 'utf8');
              }
              
              // Check if all test generation jobs are complete
              const remainingJobs = await pool.query(
                `SELECT COUNT(*) as count FROM ai_jobs 
                 WHERE args->>'qa_session_id' = $1 
                   AND args->>'phase' = 'test_generation'
                   AND status IN ('pending', 'running')`,
                [qaSessionId]
              );
              
              const remainingCount = parseInt(remainingJobs.rows[0].count);
              
              if (remainingCount === 0) {
                // All test generation jobs completed
                await pool.query(
                  'UPDATE qa_sessions SET status = $1, report_path = $2, completed_at = $3 WHERE id = $4',
                  ['completed', `docs/TESTS_${qaSessionId}/all_tests.js`, new Date(), qaSessionId]
                );
                console.log(`All test generation completed for QA session ${qaSessionId} (${totalStories} stories)`);
              } else {
                console.log(`Test generation progress for QA session ${qaSessionId}: ${totalStories - remainingCount}/${totalStories} completed`);
              }
            }
          } else {
            // This is full QA execution - parse and save results
            console.log(`[Worker] Processing QA execution results for session ${qaSessionId}`);
            console.log(`[Worker] Output length: ${result.output?.length || 0} characters`);
            
            // Parse JSON from AI output - try multiple patterns (same as test plan generation)
            let jsonMatch: RegExpMatchArray | null = null;
            let jsonString = '';
            
            // Try pattern 1: ```json ... ```
            jsonMatch = result.output.match(/```\s*json\s*([\s\S]*?)\s*```/i);
            if (jsonMatch && jsonMatch[1]) {
              jsonString = jsonMatch[1].trim();
              console.log('[Worker] Found JSON using pattern 1 (json code block)');
            }
            
            // Try pattern 1b: Look for JSON after "```json" even if there's text before it
            if (!jsonString) {
              const jsonBlockIndex = result.output.toLowerCase().indexOf('```json');
              if (jsonBlockIndex !== -1) {
                const afterJsonBlock = result.output.substring(jsonBlockIndex);
                jsonMatch = afterJsonBlock.match(/```\s*json\s*([\s\S]*?)\s*```/i);
                if (jsonMatch && jsonMatch[1]) {
                  jsonString = jsonMatch[1].trim();
                  console.log('[Worker] Found JSON using pattern 1b (json code block after text)');
                }
              }
            }
            
            // Try pattern 2: ``` ... ``` (without json, but contains object)
            if (!jsonString) {
              jsonMatch = result.output.match(/```\s*([\s\S]*?)\s*```/);
              if (jsonMatch && jsonMatch[1]) {
                const candidate = jsonMatch[1].trim();
                if (candidate.startsWith('{') || candidate.startsWith('[')) {
                  try {
                    const parsed = JSON.parse(candidate);
                    if (typeof parsed === 'object') {
                      jsonString = candidate;
                      console.log('[Worker] Found JSON using pattern 2 (code block with object)');
                    }
                  } catch {
                    // Not valid JSON, continue
                  }
                }
              }
            }
            
            // Try pattern 3: Find JSON object directly in text
            if (!jsonString) {
              jsonMatch = result.output.match(/\{\s*"summary"[\s\S]*?\}/);
              if (jsonMatch && jsonMatch[0]) {
                jsonString = jsonMatch[0].trim();
                console.log('[Worker] Found JSON using pattern 3 (direct object match)');
              }
            }
            
            // Try pattern 4: Find JSON by looking for { and }
            if (!jsonString) {
              const jsonStart = result.output.indexOf('{');
              const jsonEnd = result.output.lastIndexOf('}');
              if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const candidate = result.output.substring(jsonStart, jsonEnd + 1).trim();
                if (candidate.startsWith('{') && candidate.endsWith('}')) {
                  try {
                    const parsed = JSON.parse(candidate);
                    if (typeof parsed === 'object' && parsed.summary) {
                      jsonString = candidate;
                      console.log('[Worker] Found JSON using pattern 4 (bracket matching)');
                    }
                  } catch {
                    // Not valid JSON, continue
                  }
                }
              }
            }
            
            // Try pattern 5: Look for JSON after common markers
            if (!jsonString) {
              const markers = ['Output:', 'Results:', 'Summary:', 'JSON:', 'Result:', 'Test Results:', 'Here is', 'Here\'s'];
              for (const marker of markers) {
                const markerIndex = result.output.toLowerCase().indexOf(marker.toLowerCase());
                if (markerIndex !== -1) {
                  const afterMarker = result.output.substring(markerIndex + marker.length);
                  const jsonStart = afterMarker.indexOf('{');
                  const jsonEnd = afterMarker.lastIndexOf('}');
                  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                    const candidate = afterMarker.substring(jsonStart, jsonEnd + 1).trim();
                    if (candidate.startsWith('{') && candidate.endsWith('}')) {
                      try {
                        const parsed = JSON.parse(candidate);
                        if (typeof parsed === 'object' && parsed.summary) {
                          jsonString = candidate;
                          console.log(`[Worker] Found JSON using pattern 5 (after marker: ${marker})`);
                          break;
                        }
                      } catch {
                        // Not valid JSON, continue
                      }
                    }
                  }
                }
              }
            }
            
            // Try pattern 6: Character-by-character search for valid JSON object
            if (!jsonString) {
              try {
                const output = result.output || '';
                let bestCandidate: { json: string; hasSummary: boolean } | null = null;
                
                for (let start = 0; start < output.length; start++) {
                  if (output[start] === '{') {
                    let braceDepth = 0;
                    let bracketDepth = 0;
                    let inString = false;
                    let escapeNext = false;
                    let end = -1;
                    
                    for (let i = start; i < output.length; i++) {
                      const char = output[i];
                      
                      if (escapeNext) {
                        escapeNext = false;
                        continue;
                      }
                      
                      if (char === '\\') {
                        escapeNext = true;
                        continue;
                      }
                      
                      if (char === '"' && !escapeNext) {
                        inString = !inString;
                        continue;
                      }
                      
                      if (!inString) {
                        if (char === '{') braceDepth++;
                        if (char === '}') braceDepth--;
                        if (char === '[') bracketDepth++;
                        if (char === ']') bracketDepth--;
                        
                        if (braceDepth === 0 && bracketDepth === 0 && i > start) {
                          end = i;
                          break;
                        }
                      }
                    }
                    
                    if (end > start) {
                      const candidate = output.substring(start, end + 1);
                      try {
                        const parsed = JSON.parse(candidate);
                        if (typeof parsed === 'object' && parsed.summary) {
                          // Prefer objects with summary field
                          if (!bestCandidate || !bestCandidate.hasSummary) {
                            bestCandidate = { json: candidate, hasSummary: true };
                          }
                        } else if (typeof parsed === 'object') {
                          // Fallback to any valid object
                          if (!bestCandidate) {
                            bestCandidate = { json: candidate, hasSummary: false };
                          }
                        }
                      } catch {
                        // Not valid JSON, continue
                      }
                    }
                  }
                }
                
                if (bestCandidate) {
                  jsonString = bestCandidate.json;
                  console.log(`[Worker] Found JSON using pattern 6 (character-by-character, hasSummary: ${bestCandidate.hasSummary})`);
                }
              } catch (e) {
                console.error(`[Worker] Pattern 6 search failed:`, e);
              }
            }
            
            if (!jsonString) {
              // Log the full output for debugging
              console.error(`[Worker] ========== FULL QA OUTPUT START ==========`);
              console.error(result.output);
              console.error(`[Worker] ========== FULL QA OUTPUT END ==========`);
              console.error(`[Worker] Output length: ${result.output?.length || 0} characters`);
              throw new Error('No JSON found in QA output');
            }

            let qaData;
            try {
              qaData = JSON.parse(jsonString);
            } catch (parseError: any) {
              console.error(`[Worker] JSON parse error: ${parseError.message}`);
              console.error(`[Worker] JSON string (first 500 chars): ${jsonString.substring(0, 500)}`);
              console.error(`[Worker] JSON string (last 500 chars): ${jsonString.substring(Math.max(0, jsonString.length - 500))}`);
              throw new Error(`Failed to parse JSON: ${parseError.message}`);
            }
            
            if (!qaData || typeof qaData !== 'object') {
              console.error(`[Worker] Parsed result is not an object. Type: ${typeof qaData}, Value: ${JSON.stringify(qaData).substring(0, 200)}`);
              throw new Error('QA results must be a JSON object with summary and tests');
            }
            const summary = qaData.summary || {};
            const tests = qaData.tests || [];

            // Get test_type from job args or session, default to test.type or 'unit'
            const jobTestType = job.args?.test_type;
            const sessionResult = await pool.query('SELECT test_type FROM qa_sessions WHERE id = $1', [qaSessionId]);
            const sessionTestType = sessionResult.rows[0]?.test_type;

            // Save test results
            for (const test of tests) {
              // Use test_type from job args, session, test.type, or default to 'unit'
              const testType = jobTestType || sessionTestType || test.type || 'unit';
              
              await pool.query(
                `INSERT INTO test_results (session_id, test_name, test_type, status, duration, error_message, output)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  qaSessionId,
                  test.name || 'Unknown test',
                  testType,
                  test.status || 'skipped',
                  test.duration,
                  test.error,
                  JSON.stringify(test),
                ]
              );
            }

            // Update QA session
            await pool.query(
              `UPDATE qa_sessions 
               SET status = $1, 
                   total_tests = $2, 
                   passed_tests = $3, 
                   failed_tests = $4, 
                   skipped_tests = $5, 
                   coverage_percentage = $6, 
                   completed_at = $7 
               WHERE id = $8`,
              [
                'completed',
                summary.total || tests.length,
                summary.passed || tests.filter((t: any) => t.status === 'passed').length,
                summary.failed || tests.filter((t: any) => t.status === 'failed').length,
                summary.skipped || tests.filter((t: any) => t.status === 'skipped').length,
                summary.coverage,
                new Date(),
                qaSessionId,
              ]
            );

            // Save report to file
            const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [job.project_id]);
            if (projectResult.rows.length > 0) {
              const project = projectResult.rows[0];
              const reportPath = path.join(project.base_path, 'docs', `QA_REPORT_${qaSessionId}.json`);
              await fs.mkdir(path.dirname(reportPath), { recursive: true });
              await fs.writeFile(reportPath, JSON.stringify(qaData, null, 2), 'utf8');
              
              await pool.query(
                'UPDATE qa_sessions SET report_path = $1 WHERE id = $2',
                [`docs/QA_REPORT_${qaSessionId}.json`, qaSessionId]
              );
            }

            console.log(`QA session ${qaSessionId} processed successfully`);
          }
        } catch (error: any) {
          console.error(`Failed to process QA results: ${error.message}`);
          await pool.query(
            'UPDATE qa_sessions SET status = $1, completed_at = $2 WHERE id = $3',
            ['failed', new Date(), qaSessionId]
          );
        }
      }
      
      // Save Roadmap
      if (prompt.includes('create a roadmap') || prompt.includes('roadmap with milestones') ||
          prompt.includes('Roadmap') || prompt.includes('milestone')) {
        try {
          const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [job.project_id]);
          if (projectResult.rows.length > 0) {
            const project = projectResult.rows[0];
            const roadmapPath = path.join(project.base_path, 'docs', 'ROADMAP.md');
            
            // Ensure docs directory exists
            await fs.mkdir(path.dirname(roadmapPath), { recursive: true });
            
            // Parse milestones from AI output
            const milestones = parseRoadmapMilestones(result.output);
            
            // Create milestones as tasks
            const createdMilestones: any[] = [];
            for (const milestone of milestones) {
              const taskResult = await pool.query(
                `INSERT INTO tasks (project_id, title, description, type, status, priority)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [
                  job.project_id,
                  milestone.title,
                  milestone.description,
                  'milestone',
                  milestone.status || 'todo',
                  milestone.priority || 0
                ]
              );
              createdMilestones.push({
                ...milestone,
                id: taskResult.rows[0].id
              });
            }
            
            // Create roadmap content
            const roadmapContent = {
              project_id: job.project_id,
              title: 'Project Roadmap',
              description: 'Generated roadmap based on user stories',
              milestones: createdMilestones.map(m => ({
                id: m.id,
                title: m.title,
                description: m.description,
                status: m.status || 'todo',
                priority: m.priority || 0,
                targetDate: m.targetDate,
                dependencies: m.dependencies || []
              }))
            };
            
            // Generate markdown
            const markdownContent = generateRoadmapMarkdown(roadmapContent, result.output);
            
            // Save roadmap file
            await fs.writeFile(roadmapPath, markdownContent, 'utf8');
            
            // Save to database
            const artifactResult = await pool.query(
              `INSERT INTO artifacts (project_id, type, path, content)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING
               RETURNING *`,
              [job.project_id, 'roadmap', 'docs/ROADMAP.md', JSON.stringify(roadmapContent)]
            );
            
            // If artifact already exists, update it
            if (artifactResult.rows.length === 0) {
              await pool.query(
                `UPDATE artifacts 
                 SET content = $1, path = $2 
                 WHERE project_id = $3 AND type = 'roadmap'`,
                [JSON.stringify(roadmapContent), 'docs/ROADMAP.md', job.project_id]
              );
            }
            
            console.log(`Roadmap saved automatically for project ${job.project_id} with ${createdMilestones.length} milestones`);
          }
        } catch (error: any) {
          console.error(`Failed to auto-save roadmap: ${error.message}`);
          console.error(error.stack);
          // Don't fail the job if auto-save fails
        }
      }
    } else {
      await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
      await jobRepo.addEvent(jobId, 'failed', { error: result.error });
      
      // Update coding session to failed
      if (isCodingSession) {
        try {
          await pool.query(
            'UPDATE coding_sessions SET status = $1, error = $2, completed_at = $3 WHERE id = $4',
            ['failed', result.error, new Date(), codingSessionId]
          );
          await pool.query(
            'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
            [codingSessionId, 'error', JSON.stringify({ error: result.error })]
          );
          console.log(`[Worker] Coding session ${codingSessionId} failed`);
        } catch (error) {
          console.error('[Worker] Error failing coding session:', error);
        }
      }
      
      // Update QA session to failed
      if (isQASession) {
        try {
          await pool.query(
            'UPDATE qa_sessions SET status = $1, completed_at = $2 WHERE id = $3',
            ['failed', new Date(), qaSessionId]
          );
          console.log(`[Worker] QA session ${qaSessionId} failed`);
        } catch (error) {
          console.error('[Worker] Error failing QA session:', error);
        }
      }
    }
  } catch (error: any) {
    console.error(`Error processing job ${jobId}:`, error);
    await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
    await jobRepo.addEvent(jobId, 'failed', { error: error.message });
    
    // Update QA session to failed if applicable
    const qaSessionId = job.args?.qa_session_id;
    if (qaSessionId) {
      try {
        await pool.query(
          'UPDATE qa_sessions SET status = $1, completed_at = $2 WHERE id = $3',
          ['failed', new Date(), qaSessionId]
        );
        console.log(`[Worker] QA session ${qaSessionId} failed due to error`);
      } catch (err) {
        console.error('[Worker] Error failing QA session:', err);
      }
    }
    
    // Update coding session to failed if applicable
    const codingSessionId = job.args?.coding_session_id;
    if (codingSessionId) {
      try {
        await pool.query(
          'UPDATE coding_sessions SET status = $1, error = $2, completed_at = $3 WHERE id = $4',
          ['failed', error.message, new Date(), codingSessionId]
        );
        await pool.query(
          'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
          [codingSessionId, 'error', JSON.stringify({ error: error.message })]
        );
      } catch (err) {
        console.error('[Worker] Error updating failed coding session:', err);
      }
    }
  }
}

// Helper function to parse and save test suites from AI output
/**
 * Validate that generated tests are in correct location and syntactically valid
 */
async function validateGeneratedTests(
  codingSessionId: string,
  projectId: string
): Promise<void> {
  try {
    // Get test suites for this session
    const suitesResult = await pool.query(
      'SELECT id, file_path, test_code FROM test_suites WHERE coding_session_id = $1',
      [codingSessionId]
    );

    if (suitesResult.rows.length === 0) {
      throw new Error('No test suites found for validation');
    }

    // Get project info
    const projectResult = await pool.query(
      'SELECT base_path, tech_stack FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      throw new Error('Project not found');
    }

    const project = projectResult.rows[0];
    const validationErrors: string[] = [];

    for (const suite of suitesResult.rows) {
      // Validate 1: Check file is in correct MVC location (backend/tests/unit/)
      if (!suite.file_path.startsWith('backend/tests/unit/')) {
        validationErrors.push(
          `Test file in incorrect location: ${suite.file_path} (should be in backend/tests/unit/)`
        );
      }

      // Validate 2: Check file exists on disk
      const fullPath = path.join(project.base_path, suite.file_path);
      try {
        await fs.access(fullPath);
        console.log(`[Worker] ✅ Test file exists: ${suite.file_path}`);
      } catch {
        validationErrors.push(`Test file does not exist on disk: ${suite.file_path}`);
      }

      // Validate 3: Check for basic test syntax
      if (!suite.test_code.includes('describe') &&
          !suite.test_code.includes('test(') &&
          !suite.test_code.includes('it(')) {
        validationErrors.push(`Test file missing test framework syntax: ${suite.file_path}`);
      }

      // Validate 4: Check imports
      try {
        const fullPath = path.join(project.base_path, suite.file_path);
        const importValidation = await validateTestImports(fullPath, project.base_path);

        if (!importValidation.valid) {
          console.log(`[Worker] ⚠️  Test file has missing imports: ${suite.file_path}`);
          console.log(`[Worker]   Total imports: ${importValidation.totalImports}`);
          console.log(`[Worker]   Existing: ${importValidation.existingImports}`);
          console.log(`[Worker]   Missing: ${importValidation.missingImports.length}`);

          // Log each missing import
          importValidation.missingImports.forEach(missing => {
            console.log(`[Worker]   - ${missing.modulePath} ${missing.canScaffold ? '(will auto-scaffold)' : '(npm package - needs install)'}`);
          });

          // This is informational only - scaffolds will be created before test execution
          if (importValidation.canAutoFix) {
            console.log(`[Worker] ✅ All missing imports can be auto-scaffolded before test execution`);
          } else {
            console.warn(`[Worker] ⚠️  Some imports are npm packages that need installation:`);
            importValidation.missingImports
              .filter(m => !m.canScaffold)
              .forEach(m => console.warn(`[Worker]     - ${m.modulePath}`));
          }
        } else {
          console.log(`[Worker] ✅ All imports valid: ${suite.file_path}`);
        }
      } catch (importError: any) {
        console.warn(`[Worker] ⚠️  Could not validate imports for ${suite.file_path}:`, importError.message);
        // Import validation failure is non-critical at this stage - scaffolding happens before test execution
      }
    }

    if (validationErrors.length > 0) {
      console.error('[Worker] ❌ Test validation failed:');
      validationErrors.forEach(err => console.error(`  - ${err}`));
      throw new Error(`Test validation failed: ${validationErrors.join('; ')}`);
    }

    console.log(`[Worker] ✅ All ${suitesResult.rows.length} test suites validated successfully`);
  } catch (error) {
    console.error('[Worker] Error during test validation:', error);
    throw error;
  }
}

/**
 * Clean up test files that are outside the MVC structure
 */
async function cleanupIncorrectTestFiles(
  basePath: string,
  correctFileName: string,
  correctDir: string
): Promise<void> {
  try {
    // Common incorrect locations where tests might be created
    const incorrectLocations = [
      path.join(basePath, 'tests', 'unit'),
      path.join(basePath, 'test', 'unit'),
      path.join(basePath, 'src', 'tests', 'unit'),
      path.join(basePath, '__tests__')
    ];

    for (const incorrectLoc of incorrectLocations) {
      try {
        const incorrectPath = path.join(incorrectLoc, correctFileName);

        // Check if file exists in incorrect location
        await fs.access(incorrectPath);

        // File exists, delete it
        await fs.unlink(incorrectPath);
        console.log(`[Worker] 🧹 Cleaned up incorrectly placed test file: ${incorrectPath}`);

        // Also check for alternate extensions (.js vs .ts)
        const altExtension = correctFileName.endsWith('.ts') ?
          correctFileName.replace('.test.ts', '.test.js') :
          correctFileName.replace('.test.js', '.test.ts');

        const altIncorrectPath = path.join(incorrectLoc, altExtension);
        try {
          await fs.access(altIncorrectPath);
          await fs.unlink(altIncorrectPath);
          console.log(`[Worker] 🧹 Cleaned up alternate extension: ${altIncorrectPath}`);
        } catch {
          // Alternate extension doesn't exist, ignore
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.warn(`[Worker] Warning checking incorrect location ${incorrectLoc}:`, error.message);
        }
        // File doesn't exist in incorrect location, continue
      }
    }
  } catch (error) {
    console.error('[Worker] Error during cleanup of incorrect test files:', error);
    // Don't throw - cleanup is non-critical
  }
}

async function parseAndSaveTestSuites(
  projectId: string,
  codingSessionId: string,
  storyId: string | null,
  aiOutput: string,
  programmerType: string
): Promise<any[]> {
  const testSuites: any[] = [];
  
  try {
    // Get project to find base_path and tech_stack
    const projectResult = await pool.query('SELECT base_path, tech_stack FROM projects WHERE id = $1', [projectId]);
    if (projectResult.rows.length === 0) {
      throw new Error('Project not found');
    }
    const project = projectResult.rows[0];
    
    // Get story/task title for file naming
    let storyTitle = 'default';
    if (storyId) {
      const storyResult = await pool.query('SELECT title FROM tasks WHERE id = $1', [storyId]);
      if (storyResult.rows.length > 0) {
        storyTitle = storyResult.rows[0].title;
      }
    }

    // Sanitize title for filename and add unique ID to prevent collisions
    const sanitizedTitle = storyTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const shortId = storyId ? storyId.substring(0, 8) : 'default';
    const uniqueFileName = `${sanitizedTitle}-${shortId}`;

    // Determine file extension based on tech_stack
    const isTypeScript = project.tech_stack?.toLowerCase().includes('typescript') ||
                        project.tech_stack?.toLowerCase().includes('ts');
    const fileExtension = isTypeScript ? '.test.ts' : '.test.js';

    // Use MVC structure: backend/tests/unit/ (aligned with projectStructureService)
    const testBaseDir = 'backend/tests';
    const unitTestDir = path.join(project.base_path, testBaseDir, 'unit');
    await fs.mkdir(unitTestDir, { recursive: true });

    // Validate that we're using the correct MVC structure
    console.log(`[Worker] ✅ Using MVC structure for tests: ${testBaseDir}/unit/`);
    
    // Parse test code from AI output
    // Look for code blocks with test code (must be in markdown code blocks)
    const codeBlockRegex = /```(?:javascript|js|typescript|ts|test|tsx|jsx)?\s*\n([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let match;

    while ((match = codeBlockRegex.exec(aiOutput)) !== null) {
      const code = match[1].trim();
      // Validate that it's actual code, not narrative text
      if (code.includes('describe(') || code.includes('it(') || code.includes('test(') ||
          code.includes('import ') || code.includes('require(') || code.includes('const ') ||
          code.includes('function ')) {
        codeBlocks.push(code);
      } else {
        console.warn('[Worker] ⚠️ Skipping code block that appears to be narrative text');
      }
    }

    // If no valid code blocks found, reject the output
    if (codeBlocks.length === 0) {
      console.error('[Worker] ❌ No valid test code found in AI output');
      console.error('[Worker] Output preview:', aiOutput.substring(0, 500));
      throw new Error('AI generated narrative text instead of test code. No code blocks with tests found in output.');
    }
    
    // Determine test type based on content and programmer type
    // IMPORTANT: We always force unit tests only - ignore e2e, integration, and load tests
    const detectTestType = (code: string): 'unit' | 'integration' | 'e2e' => {
      // Always return 'unit' - we only generate unit tests
      // This filters out e2e, integration, and load tests as requested
      return 'unit';
    };
    
    // Create test suites - one per code block or combine into types
    const testSuitesByType: Map<string, { code: string; name: string }> = new Map();
    
    codeBlocks.forEach((code, index) => {
      const testType = detectTestType(code);
      const typeKey = `${testType}_${programmerType}`;
      
      if (!testSuitesByType.has(typeKey)) {
        testSuitesByType.set(typeKey, {
          code: code,
          name: `${testType}_${programmerType}_tests`
        });
      } else {
        // Append to existing suite
        const existing = testSuitesByType.get(typeKey)!;
        existing.code += '\n\n' + code;
      }
    });
    
    // If no test suites detected, create a default one
    if (testSuitesByType.size === 0) {
      testSuitesByType.set(`unit_${programmerType}`, {
        code: aiOutput,
        name: `unit_${programmerType}_tests`
      });
    }
    
    // Create test suite records in database and save files
    // Use single file per functionality with unique ID to prevent collisions
    const fileName = `${uniqueFileName}${fileExtension}`;
    const filePath = path.join(unitTestDir, fileName);
    
    // Combine all test code into one file
    let combinedTestCode = '';
    for (const [typeKey, suiteData] of testSuitesByType.entries()) {
      if (combinedTestCode) {
        combinedTestCode += '\n\n';
      }
      combinedTestCode += suiteData.code;
    }
    
    // If file exists, append tests (traditional TDD: iterate on same file)
    let finalTestCode = combinedTestCode;
    try {
      const existingContent = await fs.readFile(filePath, 'utf8');
      finalTestCode = existingContent + '\n\n' + combinedTestCode;
      console.log(`[Worker] Appending tests to existing file: ${filePath}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, create new one
      console.log(`[Worker] Creating new test file: ${filePath}`);
    }
    
    // Save test file
    await fs.writeFile(filePath, finalTestCode, 'utf8');

    // Clean up duplicate or incorrectly placed test files
    await cleanupIncorrectTestFiles(project.base_path, fileName, unitTestDir);

    // Create test suite in database (one suite per file)
    const firstKey = testSuitesByType.keys().next().value;
    const [testType] = firstKey ? firstKey.split('_') : ['unit'];
    const suiteResult = await pool.query(
      `INSERT INTO test_suites (project_id, coding_session_id, story_id, name, description, test_type, status, file_path, test_code, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        projectId,
        codingSessionId,
        storyId,
        `${uniqueFileName}_tests`,
        `Generated ${testType} tests for ${storyTitle}`,
        testType as 'unit' | 'integration' | 'e2e',
        'ready',
        `${testBaseDir}/unit/${fileName}`, // Use MVC structure path
        finalTestCode,
        new Date()
      ]
    );
    
    testSuites.push(suiteResult.rows[0]);
    
    console.log(`[Worker] Created ${testSuites.length} test suite(s) for coding session ${codingSessionId}`);
  } catch (error: any) {
    console.error('[Worker] Error parsing and saving test suites:', error);
    throw error;
  }
  
  return testSuites;
}

// Helper function to execute all test suites for a coding session
async function executeTestSuitesForSession(codingSessionId: string, includeFailed: boolean = false): Promise<void> {
  try {
    // Get all test suites for this session
    // During refactoring, we need to re-execute failed tests, so include 'failed' status
    const statusFilter = includeFailed 
      ? "status IN ('ready', 'failed')" 
      : "status = 'ready'";
    
    const suitesResult = await pool.query(
      `SELECT id, project_id, test_type, file_path, test_code FROM test_suites WHERE coding_session_id = $1 AND ${statusFilter}`,
      [codingSessionId]
    );
    
    if (suitesResult.rows.length === 0) {
      console.log(`[Worker] No test suites found for coding session ${codingSessionId}${includeFailed ? ' (including failed)' : ''}`);
      return;
    }
    
    console.log(`[Worker] Executing ${suitesResult.rows.length} test suite(s) for coding session ${codingSessionId}`);
    
    // Get project to find base_path and tech_stack
    const projectResult = await pool.query(
      'SELECT base_path, tech_stack FROM projects WHERE id = $1',
      [suitesResult.rows[0].project_id]
    );
    
    if (projectResult.rows.length === 0) {
      throw new Error('Project not found');
    }
    
    const project = projectResult.rows[0];
    const techStack = (project.tech_stack || 'nodejs').toLowerCase();
    
    // Execute each test suite
    for (const suite of suitesResult.rows) {
      try {
        // Update suite status to running
        await pool.query(
          'UPDATE test_suites SET status = $1 WHERE id = $2',
          ['running', suite.id]
        );
        
        // Create execution record
        const executionResult = await pool.query(
          `INSERT INTO test_executions (test_suite_id, execution_type, status, started_at)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [suite.id, 'auto', 'running', new Date()]
        );
        
        const executionId = executionResult.rows[0].id;
        
        // Determine test command based on tech stack
        let testCommand: string;
        let testArgs: string[] = [];
        
        if (techStack.includes('node') || techStack.includes('javascript') || techStack.includes('typescript')) {
          // Try to detect test framework
          const testCode = suite.test_code || '';
          if (testCode.includes('jest') || testCode.includes('describe') && testCode.includes('it')) {
            testCommand = 'npm';
            testArgs = ['test', '--', suite.file_path || ''];
          } else if (testCode.includes('mocha')) {
            testCommand = 'npx';
            testArgs = ['mocha', suite.file_path || ''];
          } else {
            // Default to jest
            testCommand = 'npm';
            testArgs = ['test', '--', suite.file_path || ''];
          }
        } else if (techStack.includes('python')) {
          testCommand = 'python';
          testArgs = ['-m', 'pytest', suite.file_path || ''];
        } else {
          // Default: assume nodejs with jest
          testCommand = 'npm';
          testArgs = ['test', '--', suite.file_path || ''];
        }
        
        // Only execute tests for JavaScript/TypeScript projects for now
        if (!techStack.includes('node') && !techStack.includes('javascript') && !techStack.includes('typescript')) {
          console.log(`[Worker] Test execution for ${techStack} not yet implemented, marking as skipped`);
          await pool.query(
            `UPDATE test_executions 
             SET status = $1, completed_at = $2, duration = $3, total_tests = $4, passed_tests = $4, skipped_tests = $5, output = $6
             WHERE id = $7`,
            ['skipped', new Date(), 0, 0, 0, `Test execution for ${techStack} not yet implemented`, executionId]
          );
          await pool.query(
            'UPDATE test_suites SET status = $1, executed_at = $2 WHERE id = $3',
            ['skipped', new Date(), suite.id]
          );
          continue;
        }
        
        const projectPath = project.base_path;
        const startTime = Date.now();

        // VALIDATION CHECKPOINT: Verify test file exists
        const testFilePath = path.join(projectPath, suite.file_path);
        try {
          await fs.access(testFilePath);
          console.log(`[Worker] ✓ Test file exists: ${suite.file_path}`);
        } catch (error: any) {
          const errorMsg = `Test file not found: ${suite.file_path}`;
          console.error(`[Worker] ✗ ${errorMsg}`);

          await pool.query(
            `UPDATE test_executions
             SET status = $1, completed_at = $2, duration = $3, output = $4, error = $5
             WHERE id = $6`,
            ['failed', new Date(), Date.now() - startTime, '', errorMsg, executionId]
          );

          await pool.query(
            'UPDATE test_suites SET status = $1, error = $2 WHERE id = $3',
            ['failed', errorMsg, suite.id]
          );

          continue; // Skip to next test suite
        }

        // VALIDATION CHECKPOINT: Verify package.json exists
        const packageJsonPath = path.join(projectPath, 'package.json');
        let hasJest = false;
        try {
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
          const packageJson = JSON.parse(packageJsonContent);
          hasJest = Boolean(packageJson.devDependencies?.jest || packageJson.dependencies?.jest);

          if (!hasJest) {
            console.warn(`[Worker] ⚠ Jest not found in package.json dependencies`);
          } else {
            console.log(`[Worker] ✓ Jest found in package.json`);
          }
        } catch (error: any) {
          console.warn(`[Worker] ⚠ Could not verify package.json: ${error.message}`);
        }

        // VALIDATION CHECKPOINT: Verify node_modules exists
        const nodeModulesPath = path.join(projectPath, 'node_modules');
        try {
          await fs.access(nodeModulesPath);
          console.log(`[Worker] ✓ node_modules directory exists`);
        } catch (error: any) {
          const errorMsg = 'node_modules not found. Run "npm install" first.';
          console.error(`[Worker] ✗ ${errorMsg}`);

          await pool.query(
            `UPDATE test_executions
             SET status = $1, completed_at = $2, duration = $3, output = $4, error = $5
             WHERE id = $6`,
            ['failed', new Date(), Date.now() - startTime, '', errorMsg, executionId]
          );

          await pool.query(
            'UPDATE test_suites SET status = $1, error = $2 WHERE id = $3',
            ['failed', errorMsg, suite.id]
          );

          continue; // Skip to next test suite
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4712',message:'Starting test execution',data:{suiteId:suite.id,suiteName:suite.name,testFilePath:suite.file_path,codingSessionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
        // #endregion

        // PHASE 2: Pre-test health check
        console.log(`[Worker] 🏥 Running pre-test health check...`);
        try {
          const healthCheck = await performPreTestHealthCheck(projectPath, testFilePath);
          const report = formatHealthCheckReport(healthCheck);

          console.log(`[Worker] Health Check Report:\n${report}`);

          if (!healthCheck.canProceed) {
            const errorMsg = `Health check failed: ${healthCheck.criticalIssues.join(', ')}`;
            console.error(`[Worker] ❌ ${errorMsg}`);

            await pool.query(
              `UPDATE test_executions
               SET status = $1, completed_at = $2, duration = $3, output = $4, error = $5
               WHERE id = $6`,
              ['failed', new Date(), Date.now() - startTime, report, errorMsg, executionId]
            );

            await pool.query(
              'UPDATE test_suites SET status = $1, error = $2 WHERE id = $3',
              ['failed', errorMsg, suite.id]
            );

            continue; // Skip to next test suite
          }

          if (healthCheck.warnings.length > 0) {
            console.warn(`[Worker] ⚠️  Health check warnings: ${healthCheck.warnings.join(', ')}`);
          } else {
            console.log(`[Worker] ✅ Health check passed - all systems ready`);
          }
        } catch (healthError: any) {
          console.warn(`[Worker] ⚠️  Health check failed to run: ${healthError.message}`);
          // Continue anyway - health check failure shouldn't block execution
        }

        // Validate imports and create scaffolds before executing tests (TDD auto-scaffolding)
        console.log(`[Worker] 🔍 Validating imports for ${testFilePath}...`);
        try {
          const importValidation = await validateTestImports(testFilePath, projectPath);
          console.log(`[Worker] 🔍 Import validation complete. Valid: ${importValidation.valid}, Missing: ${importValidation.missingImports.length}`);

          if (!importValidation.valid && importValidation.missingImports.length > 0) {
            console.log(`[Worker] 🔧 Creating scaffolds for ${importValidation.missingImports.length} missing imports...`);

            // Create scaffolds for missing imports
            const scaffoldResults = await createScaffoldsForMissingImports(
              importValidation.missingImports,
              projectPath
            );

            // Log scaffold results
            scaffoldResults.forEach(result => {
              if (result.created) {
                console.log(`[Worker] ✅ Created scaffold: ${result.filePath}`);
                if (result.imports && result.imports.length > 0) {
                  console.log(`[Worker]    Exports: ${result.imports.join(', ')}`);
                }
              } else if (result.error) {
                console.warn(`[Worker] ⚠️  Could not scaffold ${result.filePath}: ${result.error}`);
              }
            });

            const successCount = scaffoldResults.filter(r => r.created).length;
            console.log(`[Worker] ✅ Created ${successCount}/${scaffoldResults.length} scaffolds successfully`);
          }
        } catch (scaffoldError: any) {
          console.warn(`[Worker] ⚠️  Scaffold creation failed for ${suite.file_path}:`, scaffoldError.message);
          // Continue anyway - tests might still work
        }

        // Execute tests using Jest
        const { spawn } = require('child_process');
        const testResult = await new Promise<{
          success: boolean;
          output: string;
          error: string;
          exitCode: number;
        }>((resolve) => {
          console.log(`[Worker] Executing tests for suite ${suite.id}...`);
          
          // Use npm test with the specific test file
          const testFile = suite.file_path || '';
          const args = testFile ? ['test', '--', testFile] : ['test'];
          
          const childProcess = spawn('npm', args, {
            cwd: projectPath,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          let output = '';
          let errorOutput = '';
          
          childProcess.stdout.on('data', (data: Buffer) => {
            output += data.toString();
          });
          
          childProcess.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });
          
          childProcess.on('close', (code: number | null) => {
            resolve({
              success: code === 0,
              output: output + errorOutput,
              error: errorOutput,
              exitCode: code || 0
            });
          });
          
          childProcess.on('error', (error: Error) => {
            resolve({
              success: false,
              output: errorOutput,
              error: error.message,
              exitCode: 1
            });
          });
        });
        
        const duration = Date.now() - startTime;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4765',message:'Test execution completed',data:{suiteId:suite.id,executionId,testResultSuccess:testResult.success,outputLength:testResult.output?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
        // #endregion
        
        // Parse Jest output to extract test statistics
        const stats = parseJestOutput(testResult.output);

        // Analyze Jest errors for better diagnostics
        const errorAnalysis = analyzeJestErrors(testResult.error, testResult.output);

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4768',message:'Jest stats parsed',data:{stats,suiteId:suite.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
        // #endregion

        // Update execution with results
        await pool.query(
          `UPDATE test_executions 
           SET status = $1, completed_at = $2, duration = $3, total_tests = $4, 
               passed_tests = $5, failed_tests = $6, skipped_tests = $7, output = $8, error_message = $9
           WHERE id = $10`,
          [
            testResult.success && stats.failed === 0 ? 'passed' : 'failed',
            new Date(),
            duration,
            stats.total,
            stats.passed,
            stats.failed,
            stats.skipped,
            testResult.output,
            testResult.error || null,
            executionId
          ]
        );
        
        // Update suite status
        await pool.query(
          'UPDATE test_suites SET status = $1, executed_at = $2 WHERE id = $3',
          [testResult.success && stats.failed === 0 ? 'passed' : 'failed', new Date(), suite.id]
        );
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4794',message:'PostgreSQL updated, about to sync AgentDB',data:{suiteId:suite.id,codingSessionId,suiteName:suite.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
        // #endregion
        
        console.log(`[Worker] ✅ Test suite ${suite.id} execution completed:`);
        console.log(`[Worker]   📊 Results: ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped (${stats.total} total)`);
        console.log(`[Worker]   ⏱️  Duration: ${duration}ms`);
        console.log(`[Worker]   ${testResult.success && stats.failed === 0 ? '✅ Status: PASSED' : '❌ Status: FAILED'}`);

        // Log error analysis if errors were detected
        if (errorAnalysis.hasErrors) {
          console.log(`[Worker] 🔍 Error Analysis:`);
          errorAnalysis.errors.forEach(err => {
            console.log(`[Worker]   ❌ ${err.type}: ${err.message}`);
            if (err.details) {
              console.log(`[Worker]      Details: ${JSON.stringify(err.details)}`);
            }
          });

          if (errorAnalysis.suggestedFixes.length > 0) {
            console.log(`[Worker] 💡 Suggested Fixes:`);
            errorAnalysis.suggestedFixes.forEach((fix, idx) => {
              console.log(`[Worker]   ${idx + 1}. ${fix}`);
            });
          }
        }
        
        // Update AgentDB test status to sync with PostgreSQL
        try {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4802',message:'Starting AgentDB sync',data:{suiteId:suite.id,codingSessionId,testResultSuccess:testResult.success,statsFailed:stats.failed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
          // #endregion
          console.log(`[Worker] 🔄 Attempting to sync test status to AgentDB for suite ${suite.id}`);
          const projectResult = await pool.query(
            'SELECT base_path FROM projects WHERE id = (SELECT project_id FROM coding_sessions WHERE id = $1)',
            [codingSessionId]
          );
          
          if (projectResult.rows.length > 0) {
            const projectPath = projectResult.rows[0].base_path;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4810',message:'Project path retrieved',data:{projectPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
            // #endregion
            console.log(`[Worker] 📁 Project path: ${projectPath}`);
            
            const { AgentDBStateManager } = await import('../../backend/src/services/agentdb/AgentDBStateManager');
            const stateManager = new AgentDBStateManager(projectPath, codingSessionId);
            
            // Get test name from suite - try multiple methods to match
            const suiteName = suite.name || '';
            const testCode = suite.test_code || '';
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4817',message:'Test name extraction',data:{suiteName,testCodeLength:testCode.length,testCodePreview:testCode.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
            // #endregion
            console.log(`[Worker] 🔍 Suite name: "${suiteName}", test code length: ${testCode.length}`);
            
            // Extract test name from test code if available
            // Try multiple patterns: it('name'), test('name'), describe('name')
            const testNameMatch = testCode.match(/(?:it|test|describe)\(['"]([^'"]+)['"]/);
            const extractedTestName = testNameMatch ? testNameMatch[1] : null;
            const testNameToMatch = suiteName || extractedTestName || '';
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4825',message:'Test name to match determined',data:{extractedTestName,testNameToMatch},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
            // #endregion
            console.log(`[Worker] 🔍 Extracted test name: "${extractedTestName}", final name to match: "${testNameToMatch}"`);
            
            if (testNameToMatch) {
              // Get all tests from AgentDB to find the matching test
              const state = await stateManager.loadState();
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4831',message:'AgentDB state loaded',data:{hasState:!!state,testCount:state?.tests?.length||0,testNames:state?.tests?.map((t:any)=>t.name)||[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
              // #endregion
              if (state && state.tests && state.tests.length > 0) {
                console.log(`[Worker] 📋 Found ${state.tests.length} tests in AgentDB state`);
                console.log(`[Worker] 📋 Test names in AgentDB: ${state.tests.map((t: any) => `"${t.name}"`).join(', ')}`);
                
                // Try to find matching test by name (exact or partial match)
                const testIndex = state.tests.findIndex((t: any) => {
                  const agentdbTestName = t.name || '';
                  const exactMatch = agentdbTestName === testNameToMatch;
                  const includesMatch = agentdbTestName.includes(testNameToMatch) || testNameToMatch.includes(agentdbTestName);
                  const caseInsensitiveMatch = agentdbTestName.toLowerCase() === testNameToMatch.toLowerCase();
                  
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4837',message:'Comparing test names',data:{agentdbTestName,testNameToMatch,exactMatch,includesMatch,caseInsensitiveMatch},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
                  // #endregion
                  
                  if (exactMatch || includesMatch || caseInsensitiveMatch) {
                    console.log(`[Worker] ✅ Found match: "${agentdbTestName}" matches "${testNameToMatch}"`);
                    return true;
                  }
                  return false;
                });
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4848',message:'Test index search result',data:{testIndex,testNameToMatch},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
                // #endregion
                
                if (testIndex >= 0) {
                  const agentdbStatus = testResult.success && stats.failed === 0 ? 'passing' : 'failing';
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4851',message:'Before updateTestStatus',data:{testIndex,agentdbStatus,currentStatus:state.tests[testIndex]?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
                  // #endregion
                  console.log(`[Worker] 💾 Updating AgentDB test at index ${testIndex} to status: ${agentdbStatus}`);
                  await stateManager.updateTestStatus(testIndex, agentdbStatus);
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4854',message:'After updateTestStatus',data:{testIndex,agentdbStatus},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
                  // #endregion
                  console.log(`[Worker] ✅ Updated AgentDB test status: "${state.tests[testIndex].name}" -> ${agentdbStatus}`);
                  
                  // Verify the update
                  const verifyState = await stateManager.loadState();
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4858',message:'Verification after update',data:{testIndex,verifiedStatus:verifyState?.tests?.[testIndex]?.status,expectedStatus:agentdbStatus},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
                  // #endregion
                  if (verifyState && verifyState.tests[testIndex]) {
                    console.log(`[Worker] ✅ Verified: test status is now "${verifyState.tests[testIndex].status}"`);
                  }
                } else {
                  console.log(`[Worker] ⚠️ Test "${testNameToMatch}" not found in AgentDB state (${state.tests.length} tests available)`);
                  console.log(`[Worker] ⚠️ Available test names: ${state.tests.map((t: any, i: number) => `${i}: "${t.name}" (status: ${t.status})`).join(', ')}`);
                }
              } else {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4865',message:'No tests in AgentDB state',data:{hasState:!!state,hasTests:!!state?.tests},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
                // #endregion
                console.log(`[Worker] ⚠️ No tests found in AgentDB state for session ${codingSessionId}`);
              }
            } else {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4869',message:'Could not extract test name',data:{suiteId:suite.id,suiteName,extractedTestName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
              // #endregion
              console.log(`[Worker] ⚠️ Could not extract test name from suite ${suite.id} (suiteName: "${suiteName}", extracted: "${extractedTestName}")`);
            }
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4873',message:'Project not found',data:{codingSessionId,projectResultRows:projectResult.rows.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
            // #endregion
            console.log(`[Worker] ⚠️ Project not found for coding session ${codingSessionId}`);
          }
        } catch (agentdbError: any) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/5b170222-ee7f-4866-b070-82670b1c690b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker.ts:4876',message:'Error updating AgentDB',data:{error:agentdbError.message,stack:agentdbError.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch((e)=>{console.error('[Debug] Log fetch failed:',e.message);});
          // #endregion
          console.error(`[Worker] ❌ Error updating AgentDB test status: ${agentdbError.message}`);
          console.error(`[Worker] Error stack: ${agentdbError.stack}`);
          // Don't fail the test execution if AgentDB update fails
        }
        
      } catch (error: any) {
        console.error(`[Worker] Error executing test suite ${suite.id}:`, error);
        
        // Mark execution as error
        await pool.query(
          `UPDATE test_executions 
           SET status = $1, completed_at = $2, error_message = $3
           WHERE test_suite_id = $4 AND status = 'running'`,
          ['error', new Date(), error.message, suite.id]
        );
        
        await pool.query(
          'UPDATE test_suites SET status = $1, executed_at = $2 WHERE id = $3',
          ['failed', new Date(), suite.id]
        );
        
        // Update AgentDB test status to 'failing' on error
        try {
          const projectResult = await pool.query(
            'SELECT base_path FROM projects WHERE id = (SELECT project_id FROM coding_sessions WHERE id = $1)',
            [codingSessionId]
          );
          
          if (projectResult.rows.length > 0) {
            const projectPath = projectResult.rows[0].base_path;
            
            const { AgentDBStateManager } = await import('../../backend/src/services/agentdb/AgentDBStateManager');
            const stateManager = new AgentDBStateManager(projectPath, codingSessionId);
            
            const suiteName = suite.name || '';
            const testCode = suite.test_code || '';
            const testNameMatch = testCode.match(/test\(['"]([^'"]+)['"]|it\(['"]([^'"]+)['"]|describe\(['"]([^'"]+)['"]/);
            const extractedTestName = testNameMatch ? (testNameMatch[1] || testNameMatch[2] || testNameMatch[3]) : null;
            const testNameToMatch = suiteName || extractedTestName || '';
            
            if (testNameToMatch) {
              const state = await stateManager.loadState();
              if (state && state.tests && state.tests.length > 0) {
                const testIndex = state.tests.findIndex((t: any) => {
                  const agentdbTestName = t.name || '';
                  return agentdbTestName === testNameToMatch || 
                         agentdbTestName.includes(testNameToMatch) || 
                         testNameToMatch.includes(agentdbTestName) ||
                         agentdbTestName.toLowerCase() === testNameToMatch.toLowerCase();
                });
                
                if (testIndex >= 0) {
                  await stateManager.updateTestStatus(testIndex, 'failing');
                  console.log(`[Worker] ✅ Updated AgentDB test status: "${state.tests[testIndex].name}" -> failing (error)`);
                }
              }
            }
          }
        } catch (agentdbError: any) {
          console.warn(`[Worker] ⚠️ Could not update AgentDB test status on error: ${agentdbError.message}`);
        }
      }
    }
    
    // Log summary after all suites are executed
    const summaryResult = await pool.query(
      `SELECT 
        COUNT(*) as total_suites,
        SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed_suites,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_suites,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_suites
       FROM test_suites 
       WHERE coding_session_id = $1`,
      [codingSessionId]
    );
    
    if (summaryResult.rows.length > 0) {
      const summary = summaryResult.rows[0];
      console.log(`[Worker] 📊 Test Execution Summary for session ${codingSessionId}:`);
      console.log(`[Worker]   ✅ Passed suites: ${summary.passed_suites || 0}`);
      console.log(`[Worker]   ❌ Failed suites: ${summary.failed_suites || 0}`);
      console.log(`[Worker]   ⏭️  Skipped suites: ${summary.skipped_suites || 0}`);
      console.log(`[Worker]   📈 Total suites: ${summary.total_suites || 0}`);
      
      // Emit event for test execution summary
      await pool.query(
        'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
        [codingSessionId, 'test_execution_summary', JSON.stringify({
          total_suites: summary.total_suites || 0,
          passed_suites: summary.passed_suites || 0,
          failed_suites: summary.failed_suites || 0,
          skipped_suites: summary.skipped_suites || 0
        })]
      );
    }
    
    console.log(`[Worker] Completed test execution for coding session ${codingSessionId}`);
  } catch (error: any) {
    console.error('[Worker] Error executing test suites for session:', error);
    throw error;
  }
}

/**
 * Parse Jest output to extract expected vs received values and error details from failures
 */
function parseJestFailureDetails(jestOutput: string): {
  expected: string | null;
  received: string | null;
  errorType: string | null;
  errorMessage: string | null;
} {
  const result = {
    expected: null as string | null,
    received: null as string | null,
    errorType: null as string | null,
    errorMessage: null as string | null
  };

  // Extract error type (e.g., "ValidationError:", "NotFoundError:")
  const errorTypeMatch = jestOutput.match(/(\w+Error):/);
  if (errorTypeMatch) {
    result.errorType = errorTypeMatch[1];
  }

  // Extract expected value (multiple patterns)
  const expectedPatterns = [
    /Expected substring:\s*"([^"]+)"/i,
    /Expected:\s*(.+?)(?:\n|Received)/is,
    /expect\(.*?\)\.toThrow\(['"](.+?)['"]\)/,
    /expect\(.*?\)\.toBe\((.+?)\)/,
    /expect\(.*?\)\.toEqual\((.+?)\)/
  ];

  for (const pattern of expectedPatterns) {
    const match = jestOutput.match(pattern);
    if (match && match[1]) {
      result.expected = match[1].trim();
      break;
    }
  }

  // Extract received value
  const receivedPatterns = [
    /Received message:\s*"([^"]+)"/i,
    /Received:\s*(.+?)(?:\n|at\s|$)/is,
    /but got:\s*(.+?)(?:\n|$)/i
  ];

  for (const pattern of receivedPatterns) {
    const match = jestOutput.match(pattern);
    if (match && match[1]) {
      result.received = match[1].trim();
      break;
    }
  }

  // Extract error message (first line after error type)
  const errorMsgMatch = jestOutput.match(/(\w+Error):\s*(.+?)(?:\n|$)/);
  if (errorMsgMatch && errorMsgMatch[2]) {
    result.errorMessage = errorMsgMatch[2].trim();
  }

  return result;
}

/**
 * Capture failure context for intelligent retry
 */
async function captureBatchFailureContext(
  codingSessionId: string,
  batchStart: number,
  batchSize: number,
  testOutput: string,
  projectId: string
): Promise<{
  failedTests: Array<{
    name: string;
    expected: string | null;
    received: string | null;
    errorType: string | null;
    errorMessage: string | null;
    fullOutput: string;
  }>;
  currentImplementation: Record<string, string>;
  testFilePath: string;
}> {
  const context = {
    failedTests: [] as Array<{
      name: string;
      expected: string | null;
      received: string | null;
      errorType: string | null;
      errorMessage: string | null;
      fullOutput: string;
    }>,
    currentImplementation: {} as Record<string, string>,
    testFilePath: ''
  };

  try {
    // Get project info
    const projectResult = await pool.query(
      'SELECT base_path FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      return context;
    }

    const projectPath = projectResult.rows[0].base_path;

    // Get test suites for this session
    const testSuitesResult = await pool.query(
      `SELECT ts.name, ts.file_path, ts.test_code, te.output, te.error_message, te.status
       FROM test_suites ts
       LEFT JOIN test_executions te ON te.test_suite_id = ts.id
       WHERE ts.coding_session_id = $1
       ORDER BY te.completed_at DESC
       LIMIT $2`,
      [codingSessionId, batchSize]
    );

    // Parse test output for each failed test
    for (const test of testSuitesResult.rows) {
      if (test.status === 'failed' && test.output) {
        const parsed = parseJestFailureDetails(test.output);
        context.failedTests.push({
          name: test.name,
          expected: parsed.expected,
          received: parsed.received,
          errorType: parsed.errorType,
          errorMessage: parsed.errorMessage || test.error_message,
          fullOutput: test.output
        });

        // Store test file path
        if (test.file_path && !context.testFilePath) {
          context.testFilePath = test.file_path;
        }
      }
    }

    // Read current implementation files
    const commonPaths = [
      'backend/src/services',
      'backend/src/controllers',
      'backend/src/models',
      'backend/src/utils',
      'backend/src/types'
    ];

    for (const dirPath of commonPaths) {
      const fullDirPath = path.join(projectPath, dirPath);
      try {
        const files = await fs.readdir(fullDirPath);
        for (const file of files) {
          if (file.endsWith('.ts') || file.endsWith('.js')) {
            const filePath = path.join(fullDirPath, file);
            try {
              const content = await fs.readFile(filePath, 'utf8');
              const relativePath = path.relative(projectPath, filePath);
              context.currentImplementation[relativePath] = content;
            } catch {
              // Skip files that can't be read
            }
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    return context;
  } catch (error) {
    console.error('[Worker] Error capturing failure context:', error);
    return context;
  }
}

/**
 * Helper function to check if npm install is needed and execute it
 * Detects package.json changes by comparing modification times
 */
async function ensureDependenciesInstalled(projectPath: string): Promise<void> {
  const fs = require('fs');
  const path = require('path');
  const packageJsonPath = path.join(projectPath, 'package.json');
  const packageLockPath = path.join(projectPath, 'package-lock.json');

  let needsInstall = false;

  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJsonStats = fs.statSync(packageJsonPath);
      const packageJsonModified = packageJsonStats.mtimeMs;

      // Check if package-lock.json exists and is older than package.json
      if (fs.existsSync(packageLockPath)) {
        const packageLockStats = fs.statSync(packageLockPath);
        const packageLockModified = packageLockStats.mtimeMs;

        // If package.json is newer than package-lock.json by more than 5 seconds, install
        if (packageJsonModified > packageLockModified + 5000) {
          needsInstall = true;
          console.log(`[Worker] 📦 package.json modified (${Math.round((packageJsonModified - packageLockModified) / 1000)}s newer than package-lock.json)`);
        }
      } else {
        // No package-lock.json exists, definitely needs install
        needsInstall = true;
        console.log(`[Worker] 📦 package-lock.json not found, npm install needed`);
      }

      // Also check node_modules existence
      const nodeModulesPath = path.join(projectPath, 'node_modules');
      if (!fs.existsSync(nodeModulesPath)) {
        needsInstall = true;
        console.log(`[Worker] 📦 node_modules not found, npm install needed`);
      }
    }
  } catch (error) {
    console.warn(`[Worker] Could not check package.json modification time:`, error);
  }

  // Execute npm install if needed
  if (needsInstall) {
    console.log(`[Worker] 🔧 Running npm install before tests...`);
    const { spawn } = require('child_process');

    const installResult = await new Promise<{ success: boolean; output: string }>((resolve) => {
      const installProcess = spawn('npm', ['install'], {
        cwd: projectPath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      installProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      installProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      installProcess.on('close', (code: number | null) => {
        resolve({
          success: code === 0,
          output: output + errorOutput
        });
      });

      installProcess.on('error', (error: Error) => {
        resolve({
          success: false,
          output: error.message
        });
      });
    });

    if (installResult.success) {
      console.log(`[Worker] ✅ npm install completed successfully`);
    } else {
      console.error(`[Worker] ❌ npm install failed:`, installResult.output);
      // Continue anyway - tests might still work with existing dependencies
    }
  } else {
    console.log(`[Worker] ✅ Dependencies up to date, skipping npm install`);
  }
}

/**
 * Helper function to execute tests for a specific batch in TDD cycle
 */
async function executeBatchTests(codingSessionId: string, batchStart: number, batchSize: number): Promise<{
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  success: boolean;
  output?: string;
}> {
  try {
    // Get project info
    const sessionResult = await pool.query(
      'SELECT project_id FROM coding_sessions WHERE id = $1',
      [codingSessionId]
    );
    
    if (sessionResult.rows.length === 0) {
      throw new Error('Coding session not found');
    }
    
    const projectId = sessionResult.rows[0].project_id;
    const projectResult = await pool.query(
      'SELECT base_path, tech_stack FROM projects WHERE id = $1',
      [projectId]
    );
    
    if (projectResult.rows.length === 0) {
      throw new Error('Project not found');
    }
    
    const project = projectResult.rows[0];
    const techStack = (project.tech_stack || 'nodejs').toLowerCase();
    const projectPath = project.base_path;
    
    // Only execute tests for JavaScript/TypeScript projects for now
    if (!techStack.includes('node') && !techStack.includes('javascript') && !techStack.includes('typescript')) {
      console.log(`[Worker] Test execution for ${techStack} not yet implemented for batch tests`);
      return { total: 0, passed: 0, failed: 0, skipped: 0, success: true };
    }

    // Ensure dependencies are installed before running tests
    await ensureDependenciesInstalled(projectPath);

    // Get test suites for this session to validate imports and create scaffolds
    const suitesResult = await pool.query(
      'SELECT id, file_path, test_code FROM test_suites WHERE coding_session_id = $1',
      [codingSessionId]
    );

    // Validate imports and create scaffolds for missing files (TDD auto-scaffolding)
    for (const suite of suitesResult.rows) {
      try {
        const fullPath = path.join(projectPath, suite.file_path);
        const importValidation = await validateTestImports(fullPath, projectPath);

        if (!importValidation.valid && importValidation.missingImports.length > 0) {
          console.log(`[Worker] 🔧 Creating scaffolds for ${importValidation.missingImports.length} missing imports...`);

          // Create scaffolds for missing imports
          const scaffoldResults = await createScaffoldsForMissingImports(
            importValidation.missingImports,
            projectPath
          );

          // Log scaffold results
          scaffoldResults.forEach(result => {
            if (result.created) {
              console.log(`[Worker] ✅ Created scaffold: ${result.filePath}`);
              if (result.imports && result.imports.length > 0) {
                console.log(`[Worker]    Exports: ${result.imports.join(', ')}`);
              }
            } else if (result.error) {
              console.warn(`[Worker] ⚠️  Could not scaffold ${result.filePath}: ${result.error}`);
            }
          });

          const successCount = scaffoldResults.filter(r => r.created).length;
          console.log(`[Worker] ✅ Created ${successCount}/${scaffoldResults.length} scaffolds successfully`);
        }
      } catch (scaffoldError: any) {
        console.warn(`[Worker] ⚠️  Scaffold creation failed for ${suite.file_path}:`, scaffoldError.message);
        // Continue anyway - tests might still work
      }
    }

    // Execute npm test (will run all tests, Jest will handle filtering)
    const { spawn } = require('child_process');
    const startTime = Date.now();
    
    const testResult = await new Promise<{
      success: boolean;
      output: string;
      error: string;
      exitCode: number;
    }>((resolve) => {
      console.log(`[Worker] Executing batch tests (${batchStart + 1}-${batchStart + batchSize}) for session ${codingSessionId}...`);
      
      const childProcess = spawn('npm', ['test'], {
        cwd: projectPath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let output = '';
      let errorOutput = '';
      
      childProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      
      childProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });
      
      childProcess.on('close', (code: number | null) => {
        resolve({
          success: code === 0,
          output: output + errorOutput,
          error: errorOutput,
          exitCode: code || 0
        });
      });
      
      childProcess.on('error', (error: Error) => {
        resolve({
          success: false,
          output: errorOutput,
          error: error.message,
          exitCode: 1
        });
      });
    });
    
    const duration = Date.now() - startTime;
    const stats = parseJestOutput(testResult.output);

    // Analyze Jest errors for better diagnostics
    const errorAnalysis = analyzeJestErrors(testResult.error, testResult.output);

    // Log detailed statistics
    console.log(`[Worker] 📊 Batch Test Results (tests ${batchStart + 1}-${batchStart + batchSize}):`);
    console.log(`[Worker]   ✅ Passed: ${stats.passed}`);
    console.log(`[Worker]   ❌ Failed: ${stats.failed}`);
    console.log(`[Worker]   ⏭️  Skipped: ${stats.skipped}`);
    console.log(`[Worker]   📈 Total: ${stats.total}`);
    console.log(`[Worker]   ⏱️  Duration: ${duration}ms`);
    console.log(`[Worker]   ${testResult.success && stats.failed === 0 ? '✅ All tests passed!' : '❌ Some tests failed'}`);

    // Log error analysis if errors were detected
    if (errorAnalysis.hasErrors) {
      console.log(`[Worker] 🔍 Error Analysis:`);
      errorAnalysis.errors.forEach(err => {
        console.log(`[Worker]   ❌ ${err.type}: ${err.message}`);
        if (err.details) {
          console.log(`[Worker]      Details: ${JSON.stringify(err.details)}`);
        }
      });

      if (errorAnalysis.suggestedFixes.length > 0) {
        console.log(`[Worker] 💡 Suggested Fixes:`);
        errorAnalysis.suggestedFixes.forEach((fix, idx) => {
          console.log(`[Worker]   ${idx + 1}. ${fix}`);
        });
      }
    }
    
    // Emit event for real-time updates
    await pool.query(
      'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
      [codingSessionId, 'test_execution_result', JSON.stringify({
        batch_start: batchStart,
        batch_end: batchStart + batchSize,
        total: stats.total,
        passed: stats.passed,
        failed: stats.failed,
        skipped: stats.skipped,
        duration: duration,
        success: testResult.success && stats.failed === 0
      })]
    );
    
    return {
      total: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      skipped: stats.skipped,
      success: testResult.success && stats.failed === 0,
      output: testResult.output // Include full output for failure analysis
    };
  } catch (error: any) {
    console.error(`[Worker] Error executing batch tests:`, error);
    return { total: 0, passed: 0, failed: 0, skipped: 0, success: false, output: '' };
  }
}

/**
 * Parse Jest output to extract test statistics
 */
function parseJestOutput(output: string): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  const stats = { total: 0, passed: 0, failed: 0, skipped: 0 };
  
  // Pattern 1: "Tests: X passed, Y failed, Z total"
  const summaryMatch = output.match(/Tests:\s*(\d+)\s+passed,\s*(\d+)\s+failed,\s*(\d+)\s+total/i);
  if (summaryMatch) {
    stats.passed = parseInt(summaryMatch[1]) || 0;
    stats.failed = parseInt(summaryMatch[2]) || 0;
    stats.total = parseInt(summaryMatch[3]) || 0;
    return stats;
  }
  
  // Pattern 2: "X passed, Y failed"
  const simpleMatch = output.match(/(\d+)\s+passed[,\s]+(\d+)\s+failed/i);
  if (simpleMatch) {
    stats.passed = parseInt(simpleMatch[1]) || 0;
    stats.failed = parseInt(simpleMatch[2]) || 0;
    stats.total = stats.passed + stats.failed;
    return stats;
  }
  
  // Pattern 3: Jest default format "PASS" or "FAIL" with test count
  const passMatch = output.match(/(\d+)\s+passing/i);
  const failMatch = output.match(/(\d+)\s+failing/i);
  
  if (passMatch) {
    stats.passed = parseInt(passMatch[1]) || 0;
  }
  if (failMatch) {
    stats.failed = parseInt(failMatch[1]) || 0;
  }
  stats.total = stats.passed + stats.failed;
  
  return stats;
}

// Helper function to build implementation prompt with tests
async function buildImplementationPrompt(project: any, story: any, programmerType: string, testsOutput: string): Promise<string> {
  const lines: string[] = [];
  
  lines.push(`# Implementation Task: ${story.title}\n`);
  lines.push(`**Programmer Type**: ${programmerType}\n`);
  lines.push(`**Priority**: ${story.priority}\n\n`);
  
  if (story.description) {
    lines.push(`## User Story\n`);
    lines.push(`${story.description}\n\n`);
  }
  
  lines.push(`## Generated Tests\n`);
  lines.push(`The following tests have been generated. Implement the code to make these tests pass:\n`);
  lines.push(`\`\`\`\n`);
  lines.push(testsOutput);
  lines.push(`\`\`\`\n`);
  
  lines.push(`\n## Implementation Instructions\n`);
  lines.push(`Implement the user story following Test-Driven Development (TDD) principles:\n`);
  
  if (programmerType === 'backend') {
    lines.push(`- Implement API endpoints and routes to pass the tests`);
    lines.push(`- Create database models and repositories as needed`);
    lines.push(`- Implement business logic and services`);
    lines.push(`- Add error handling and validation\n`);
  } else if (programmerType === 'frontend') {
    lines.push(`- Create React components to pass the tests`);
    lines.push(`- Implement UI/UX as specified`);
    lines.push(`- Add state management and API integration`);
    lines.push(`- Ensure responsive design and accessibility\n`);
  } else {
    lines.push(`- Implement both backend and frontend to pass all tests`);
    lines.push(`- Ensure proper integration between layers\n`);
  }
  
  lines.push(`- Write clean, maintainable, and well-documented code`);
  lines.push(`- Follow the project's architecture and coding standards`);
  lines.push(`- Make sure all generated tests pass\n`);
  
  return lines.join('\n');
}

// Helper function to build test generation prompt after implementation
async function buildTestGenerationPromptAfterImplementation(
  projectId: string,
  story: any,
  programmerType: string,
  implementationOutput: string
): Promise<string> {
  const lines: string[] = [];
  
  lines.push(`# Unit Test Generation Task: ${story.title}\n`);
  lines.push(`**Programmer Type**: ${programmerType}\n`);
  lines.push(`**Priority**: ${story.priority}\n\n`);
  
  if (story.description) {
    lines.push(`## User Story\n`);
    lines.push(`${story.description}\n\n`);
  }
  
  lines.push(`## Instructions\n`);
  lines.push(`You are a QA engineer. Your task is to generate UNIT TESTS ONLY for the already implemented code.\n\n`);
  lines.push(`**IMPORTANT: Generate ONLY unit tests. Do NOT generate integration tests, E2E tests, or load tests.**\n\n`);
  lines.push(`Unit tests should test individual functions, methods, or components in isolation.\n\n`);
  
  lines.push(`## Implemented Code\n`);
  lines.push(`The following code has been implemented:\n`);
  lines.push(`\`\`\`\n`);
  lines.push(implementationOutput.substring(0, 5000)); // Limit to avoid token limits
  lines.push(`\n...\n`);
  lines.push(`\`\`\`\n\n`);
  
  if (programmerType === 'backend') {
    lines.push(`Generate UNIT tests for:`);
    lines.push(`- Individual functions and methods (in isolation)`);
    lines.push(`- Business logic and services (mocked dependencies)`);
    lines.push(`- Error handling and validation\n`);
    lines.push(`Use testing frameworks like Jest, Mocha, or similar.\n`);
    lines.push(`Mock external dependencies like database, APIs, etc.\n`);
  } else if (programmerType === 'frontend') {
    lines.push(`Generate UNIT tests for:`);
    lines.push(`- Individual React components (in isolation)`);
    lines.push(`- Component props and rendering`);
    lines.push(`- Component state and methods\n`);
    lines.push(`Use testing frameworks like Jest, React Testing Library, or similar.\n`);
    lines.push(`Mock external dependencies and API calls.\n`);
  } else {
    lines.push(`Generate UNIT tests for both:`);
    lines.push(`- Backend: Individual functions, methods, business logic (in isolation, with mocked dependencies)`);
    lines.push(`- Frontend: Individual components, props, state (in isolation, with mocked dependencies)\n`);
  }
  
  lines.push(`\n## Output Format\n`);
  lines.push(`Provide the test code in the following format:\n`);
  lines.push(`\`\`\`\n`);
  lines.push(`// Test file path: path/to/test/file.test.js\n`);
  lines.push(`// Unit test code here...\n`);
  lines.push(`\`\`\`\n`);
  lines.push(`\nGenerate complete, runnable UNIT test suites that cover the implemented code. Focus on testing individual units in isolation.`);
  
  return lines.join('\n');
}

// Helper function to build QA prompt
async function buildQAPrompt(projectId: string, codingSessionId?: string): Promise<string> {
  const projectResult = await pool.query('SELECT name, tech_stack FROM projects WHERE id = $1', [projectId]);
  const project = projectResult.rows[0];
  
  const lines: string[] = [];
  lines.push(`# Automated QA Testing Task\n`);
  lines.push(`**Project**: ${project?.name || 'Unknown'}\n`);
  lines.push(`**Tech Stack**: ${project?.tech_stack || 'Not specified'}\n\n`);
  
  lines.push(`## Instructions\n`);
  lines.push(`You are an automated QA engineer. Your task is to:\n`);
  lines.push(`1. Analyze the codebase structure\n`);
  lines.push(`2. Generate comprehensive test suites:\n`);
  lines.push(`   - Unit tests for individual functions/components\n`);
  lines.push(`   - Integration tests for API endpoints and services\n`);
  lines.push(`   - E2E tests for critical user flows\n`);
  lines.push(`3. Execute the tests and report results\n`);
  lines.push(`4. Calculate code coverage if possible\n`);
  lines.push(`5. Provide recommendations for improvements\n\n`);
  
  if (codingSessionId) {
    lines.push(`**Note**: This QA session is for a specific coding session. Focus on testing the recently implemented features.\n\n`);
  }
  
  lines.push(`## Output Format\n`);
  lines.push(`Provide test results in the following JSON format:\n`);
  lines.push(`\`\`\`json\n`);
  lines.push(`{\n`);
  lines.push(`  "summary": {\n`);
  lines.push(`    "total": 0,\n`);
  lines.push(`    "passed": 0,\n`);
  lines.push(`    "failed": 0,\n`);
  lines.push(`    "skipped": 0,\n`);
  lines.push(`    "coverage": 0\n`);
  lines.push(`  },\n`);
  lines.push(`  "tests": [\n`);
  lines.push(`    {\n`);
  lines.push(`      "name": "test name",\n`);
  lines.push(`      "type": "unit|integration|e2e",\n`);
  lines.push(`      "status": "passed|failed|skipped",\n`);
  lines.push(`      "duration": 100,\n`);
  lines.push(`      "error": "error message if failed"\n`);
  lines.push(`    }\n`);
  lines.push(`  ],\n`);
  lines.push(`  "recommendations": ["recommendation 1", "recommendation 2"]\n`);
  lines.push(`}\n`);
  lines.push(`\`\`\`\n`);
  
  return lines.join('\n');
}

// Concurrency control to prevent resource_exhausted errors
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 1; // Reduced to 1 to avoid rate limiting (was 2)
const PROCESSING_JOBS = new Set<string>(); // Track jobs currently being processed
const JOB_TIMEOUT_MINUTES = 30; // Mark jobs as failed if running for more than 30 minutes

// Clean up stuck jobs (jobs that have been running for too long)
async function cleanupStuckJobs() {
  try {
    const timeoutThreshold = new Date(Date.now() - JOB_TIMEOUT_MINUTES * 60 * 1000);
    // Also consider jobs that are running but not being tracked by this worker instance
    // These are likely from a previous worker instance that crashed or was restarted
    const shortTimeoutThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes for untracked jobs
    
    const stuckJobs = await pool.query(
      `SELECT id, started_at, command, args->>'phase' as phase, args
       FROM ai_jobs 
       WHERE status = 'running' 
         AND (
           started_at < $1 
           OR (started_at < $2 AND id::text != ALL($3::text[]))
         )`,
      [timeoutThreshold, shortTimeoutThreshold, Array.from(PROCESSING_JOBS)]
    );
    
    if (stuckJobs.rows.length > 0) {
      console.log(`[Worker] Found ${stuckJobs.rows.length} stuck job(s), marking as failed...`);
      
      for (const job of stuckJobs.rows) {
        const jobId = job.id;
        const runningTime = Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000 / 60);
        
        console.log(`[Worker] Marking job ${jobId} as failed (running for ${runningTime} minutes)`);
        
        // Mark job as failed
        await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
        await jobRepo.addEvent(jobId, 'failed', { 
          error: `Job timeout: running for more than ${runningTime} minutes`,
          timeout: true 
        });
        
        // Update related coding sessions
        const codingSessionId = job.args?.coding_session_id;
        if (codingSessionId) {
          try {
            await pool.query(
              'UPDATE coding_sessions SET status = $1, error = $2, completed_at = $3 WHERE id = $4',
              ['failed', `Job timeout after ${runningTime} minutes`, new Date(), codingSessionId]
            );
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'error', JSON.stringify({ error: `Job timeout after ${runningTime} minutes` })]
            );
          } catch (error) {
            console.error('[Worker] Error updating coding session:', error);
          }
        }
        
        // Update related QA sessions
        const qaSessionId = job.args?.qa_session_id;
        if (qaSessionId) {
          try {
            await pool.query(
              'UPDATE qa_sessions SET status = $1, completed_at = $2 WHERE id = $3',
              ['failed', new Date(), qaSessionId]
            );
          } catch (error) {
            console.error('[Worker] Error updating QA session:', error);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Worker] Error cleaning up stuck jobs:', error);
  }
}

// Poll for pending jobs
async function pollJobs() {
  try {
    // Clean up stuck jobs first
    await cleanupStuckJobs();
    
    // Only poll if we have capacity
    // Check if we're actually at capacity by verifying tracked jobs
    const trackedJobsCount = PROCESSING_JOBS.size;
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      console.log(`[Worker] At capacity (${activeJobs}/${MAX_CONCURRENT_JOBS} active jobs, ${trackedJobsCount} tracked). Waiting...`);
      // If counter is high but no jobs are tracked, reset counter (likely desync)
      if (trackedJobsCount === 0 && activeJobs > 0) {
        console.log(`[Worker] Counter desync detected (${activeJobs} active but 0 tracked), resetting...`);
        activeJobs = 0;
      } else {
      setTimeout(pollJobs, 5000); // Wait longer when at capacity
      return;
      }
    }

    // Get pending jobs, excluding those with paused coding sessions
    // Also exclude jobs that are already being processed
    const availableSlots = MAX_CONCURRENT_JOBS - activeJobs;
    const processingIds = Array.from(PROCESSING_JOBS);
    
    let query = `
      SELECT aj.id 
      FROM ai_jobs aj
      LEFT JOIN coding_sessions cs ON (
        cs.ai_job_id = aj.id 
        OR cs.test_generation_job_id = aj.id 
        OR cs.implementation_job_id = aj.id
        OR aj.args->>'coding_session_id' = cs.id::text
      )
      WHERE aj.status = 'pending' 
        AND (cs.id IS NULL OR cs.status != 'paused')
    `;
    
    const params: any[] = [];
    if (processingIds.length > 0) {
      // Cast aj.id to text for comparison with text array
      query += ` AND aj.id::text != ALL($1::text[])`;
      params.push(processingIds);
    }
    
    query += ` ORDER BY aj.created_at ASC LIMIT $${params.length + 1}`;
    params.push(availableSlots);

    const result = await pool.query(query, params);

    for (const row of result.rows) {
      const jobId = row.id;
      
      // Skip if already processing
      if (PROCESSING_JOBS.has(jobId)) {
        continue;
      }

      // Get job details to check phase
      const jobDetails = await pool.query('SELECT args FROM ai_jobs WHERE id = $1', [jobId]);
      const jobPhase = jobDetails.rows[0]?.args?.phase;
      const isTestGen = jobPhase === 'test_generation';

      // Mark as processing and increment counter
      PROCESSING_JOBS.add(jobId);
      activeJobs++;

      // Process job asynchronously (don't await to allow concurrent processing)
      processJob(jobId)
        .finally(() => {
          // Clean up when done
          PROCESSING_JOBS.delete(jobId);
          activeJobs--;
          console.log(`[Worker] Job ${jobId} completed. Active jobs: ${activeJobs}/${MAX_CONCURRENT_JOBS}`);
        })
        .catch((error) => {
          console.error(`[Worker] Error in job ${jobId}:`, error);
        });

      // Add delay between starting jobs to avoid rate limiting
      // Longer delay for test generation jobs
      const baseDelay = isTestGen ? 10000 : 5000; // 10s for test gen, 5s for others
      const jitter = Math.random() * 3000; // 0-3s random jitter to avoid thundering herd
      const delay = baseDelay + jitter;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } catch (error) {
    console.error('Error polling jobs:', error);
  }

  // Poll again after 2 seconds (or 5 if at capacity)
  const pollDelay = activeJobs >= MAX_CONCURRENT_JOBS ? 5000 : 2000;
  setTimeout(pollJobs, pollDelay);
}

/**
 * Parse generated tests from AI output for TDD cycle
 * Extracts test names and test code from the AI response
 */
async function parseGeneratedTests(output: string): Promise<Array<{name: string; code: string}>> {
  const tests: Array<{name: string; code: string}> = [];
  
  try {
    // Try to parse as JSON first (if AI returns structured JSON)
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        return parsed.map((t: any) => ({
          name: t.name || t.title || t.test_name || 'Unnamed test',
          code: t.code || t.test_code || t.test || ''
        }));
      }
    }
    
    // If not JSON, try to extract tests from code blocks
    // Pattern 1: Test blocks with names as comments
    const testBlockPattern = /(?:\/\/|#)\s*Test:\s*(.+?)\n([\s\S]*?)(?=(?:\/\/|#)\s*Test:|$)/gi;
    let match;
    
    while ((match = testBlockPattern.exec(output)) !== null) {
      tests.push({
        name: match[1].trim(),
        code: match[2].trim()
      });
    }
    
    // Pattern 2: it() or test() blocks (Jest/Mocha style)
    if (tests.length === 0) {
      const itPattern = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s*)?\([\s\S]*?\}\s*\)/gi;
      while ((match = itPattern.exec(output)) !== null) {
        tests.push({
          name: match[1].trim(),
          code: match[0].trim()
        });
      }
    }
    
    // Pattern 3: def test_*() blocks (Python pytest style)
    if (tests.length === 0) {
      const pytestPattern = /def\s+(test_[^(]+)\s*\([^)]*\):\s*([\s\S]*?)(?=\ndef\s+|$)/gi;
      while ((match = pytestPattern.exec(output)) !== null) {
        tests.push({
          name: match[1].replace(/_/g, ' ').trim(),
          code: `def ${match[1]}${match[0].substring(match[0].indexOf('('))}`
        });
      }
    }
    
    // Pattern 4: @Test annotations (Java JUnit style)
    if (tests.length === 0) {
      const junitPattern = /@Test\s+(?:public\s+)?void\s+([^(]+)\s*\([^)]*\)\s*\{([\s\S]*?)\}/gi;
      while ((match = junitPattern.exec(output)) !== null) {
        tests.push({
          name: match[1].replace(/([A-Z])/g, ' $1').trim(),
          code: match[0].trim()
        });
      }
    }
    
    // If still no tests found, try to split by describe/context blocks
    if (tests.length === 0) {
      const describePattern = /describe\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)/gi;
      while ((match = describePattern.exec(output)) !== null) {
        tests.push({
          name: match[1].trim(),
          code: match[0].trim()
        });
      }
    }
    
    console.log(`[Worker] Parsed ${tests.length} tests from AI output`);

    // Validate and filter parsed tests
    const validTests = tests.filter(test => {
      // Filter 1: Check for markdown content
      if (test.code.includes('```') || test.code.includes('##') || test.code.includes('###')) {
        console.warn(`[Worker] Filtered out markdown content from test: ${test.name}`);
        return false;
      }

      // Filter 2: Check for test framework syntax
      const hasTestFramework = test.code.includes('describe') ||
                               test.code.includes('it(') ||
                               test.code.includes('test(') ||
                               test.code.includes('def test_') ||
                               test.code.includes('@Test');

      if (!hasTestFramework) {
        console.warn(`[Worker] Test missing test framework syntax: ${test.name}`);
        return false;
      }

      // Filter 3: Check minimum code length (at least 50 chars for a real test)
      if (test.code.trim().length < 50) {
        console.warn(`[Worker] Test code too short, likely invalid: ${test.name}`);
        return false;
      }

      // Filter 4: Check for AI explanations (lines starting with "This test...")
      const lines = test.code.split('\n');
      const explanationLines = lines.filter(line =>
        line.trim().toLowerCase().startsWith('this test') ||
        line.trim().toLowerCase().startsWith('this validates') ||
        line.trim().toLowerCase().startsWith('this checks')
      );

      if (explanationLines.length > lines.length * 0.3) {
        console.warn(`[Worker] Test contains too many explanation lines: ${test.name}`);
        return false;
      }

      // Filter 5: Check for database infrastructure tests (NOT business logic)
      const testNameLower = test.name.toLowerCase();
      const testCodeLower = test.code.toLowerCase();

      // Infrastructure keywords that indicate non-business logic tests
      const infrastructurePatterns = [
        // Table/Schema related
        /test.*(?:table|tables).*(?:exist|created|has|contains)/i,
        /test.*(?:schema|migration).*(?:created|applied|run)/i,
        /test.*(?:column|field).*(?:exist|has|type|created)/i,

        // Index related
        /test.*(?:index|indices|indexes).*(?:exist|created|has)/i,

        // View/Trigger related
        /test.*(?:view|views).*(?:exist|created|materialized)/i,
        /test.*(?:trigger|triggers).*(?:exist|created|fire)/i,

        // Connection/Pool related
        /test.*(?:connection|database).*(?:pool|config|configuration|setup)/i,
        /test.*(?:connect|disconnect).*(?:database|pool)/i,

        // Constraint related
        /test.*(?:constraint|foreign key|unique constraint).*(?:exist|created|applied)/i,

        // Direct database check patterns
        /(?:expect|assert).*(?:table|column|index|view|trigger).*(?:toexist|exist|defined)/i,
        /(?:check|verify).*(?:database|schema).*(?:structure|setup)/i
      ];

      const hasInfrastructurePattern = infrastructurePatterns.some(pattern =>
        pattern.test(testNameLower) || pattern.test(testCodeLower)
      );

      if (hasInfrastructurePattern) {
        // Double-check: Is it actually business logic that mentions these keywords?
        // Business logic tests should have validation, transformation, or business rule patterns
        const businessLogicPatterns = [
          /validate/i,
          /reject.*duplicate/i,
          /(?:business|domain).*(?:rule|logic)/i,
          /authorization|permission|access/i,
          /workflow|state.*transition/i,
          /transform|calculate|compute/i,
          /mock.*(?:repository|database|query)/i  // Mocking DB calls is business logic testing
        ];

        const hasBusinessLogic = businessLogicPatterns.some(pattern =>
          pattern.test(testNameLower) || pattern.test(testCodeLower)
        );

        // If it has infrastructure patterns but NO business logic patterns, filter it out
        if (!hasBusinessLogic) {
          console.warn(`[Worker] ⚠️  FILTERED: Database infrastructure test detected (not business logic): "${test.name}"`);
          console.warn(`[Worker] Tests should focus on business logic (validations, rules, workflows), not infrastructure (tables, indexes, migrations)`);
          return false;
        }
      }

      return true;
    });

    console.log(`[Worker] After validation: ${validTests.length} valid tests out of ${tests.length} parsed`);

    // If no valid tests found after filtering, return empty array
    // DO NOT use entire output as fallback (it contains markdown and explanations)
    if (validTests.length === 0) {
      console.error('[Worker] No valid tests found after validation. AI output may contain only markdown/explanations.');
      return [];
    }

    return validTests;
    
  } catch (error) {
    console.error('[Worker] Error parsing tests:', error);
    // DO NOT return entire output as fallback - it may contain invalid code
    // Return empty array to signal parsing failure
    return [];
  }
}

// Helper function to parse roadmap milestones from AI output
function parseRoadmapMilestones(output: string): any[] {
  const milestones: any[] = [];
  
  // Try to extract milestones from markdown headers
  const lines = output.split('\n');
  let currentMilestone: any = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect milestone headers (## or ###)
    if (line.match(/^#{2,3}\s+(.+)/)) {
      if (currentMilestone) {
        milestones.push(currentMilestone);
      }
      
      const title = line.replace(/^#{2,3}\s+/, '').trim();
      currentMilestone = {
        title,
        description: '',
        status: 'todo',
        priority: milestones.length,
        dependencies: []
      };
    } 
    // Parse milestone properties
    else if (currentMilestone) {
      // Status
      if (line.match(/status:\s*(.+)/i)) {
        const status = line.match(/status:\s*(.+)/i)?.[1]?.trim().toLowerCase();
        if (status === 'done' || status === 'completed') currentMilestone.status = 'done';
        else if (status === 'in progress' || status === 'in_progress') currentMilestone.status = 'in_progress';
        else if (status === 'blocked') currentMilestone.status = 'blocked';
      }
      // Priority
      else if (line.match(/priority:\s*(\d+)/i)) {
        currentMilestone.priority = parseInt(line.match(/priority:\s*(\d+)/i)?.[1] || '0');
      }
      // Target date
      else if (line.match(/target date:\s*(.+)/i) || line.match(/date:\s*(.+)/i)) {
        const dateStr = line.match(/(?:target )?date:\s*(.+)/i)?.[1]?.trim();
        if (dateStr) currentMilestone.targetDate = dateStr;
      }
      // Dependencies
      else if (line.match(/dependencies:\s*(.+)/i)) {
        const deps = line.match(/dependencies:\s*(.+)/i)?.[1]?.split(',').map(d => d.trim()) || [];
        currentMilestone.dependencies = deps;
      }
      // Description (accumulate non-property lines)
      else if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*')) {
        if (currentMilestone.description) {
          currentMilestone.description += '\n' + line;
        } else {
          currentMilestone.description = line;
        }
      }
    }
  }
  
  // Add last milestone
  if (currentMilestone) {
    milestones.push(currentMilestone);
  }
  
  // If no milestones found, create at least one default
  if (milestones.length === 0) {
    milestones.push({
      title: 'Project Phase 1',
      description: 'Initial development phase',
      status: 'todo',
      priority: 0,
      dependencies: []
    });
  }
  
  return milestones;
}

// Helper function to generate roadmap markdown
function generateRoadmapMarkdown(roadmapContent: any, aiOutput: string): string {
  const lines: string[] = [];
  
  lines.push(`# ${roadmapContent.title}\n`);
  
  if (roadmapContent.description) {
    lines.push(`${roadmapContent.description}\n`);
  }
  
  lines.push('\n## AI-Generated Roadmap\n');
  lines.push(aiOutput);
  lines.push('\n\n---\n');
  
  lines.push('\n## Milestones Overview\n');
  
  for (const milestone of roadmapContent.milestones) {
    lines.push(`### ${milestone.title}\n`);
    
    if (milestone.description) {
      lines.push(`${milestone.description}\n`);
    }
    
    lines.push(`- **Status**: ${milestone.status}`);
    lines.push(`- **Priority**: ${milestone.priority}`);
    
    if (milestone.targetDate) {
      lines.push(`- **Target Date**: ${milestone.targetDate}`);
    }
    
    if (milestone.dependencies && milestone.dependencies.length > 0) {
      lines.push(`- **Dependencies**: ${milestone.dependencies.join(', ')}`);
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

// Synchronize activeJobs counter with database state on startup
async function syncActiveJobs() {
  try {
    const runningJobs = await pool.query(
      `SELECT id FROM ai_jobs WHERE status = 'running'`
    );
    
    // Reset counter - we'll track only jobs we actually start processing
    // Don't count jobs that are running in DB but not being tracked by this worker
    activeJobs = 0;
    PROCESSING_JOBS.clear();
    
    console.log(`[Worker] Found ${runningJobs.rows.length} job(s) in 'running' state in database`);
    console.log(`[Worker] These jobs are not being tracked by this worker instance and will be cleaned up if stuck`);
    
    // Clean up stuck jobs immediately on startup
    await cleanupStuckJobs();
  } catch (error) {
    console.error('[Worker] Error syncing active jobs:', error);
  }
}

// Start HTTP server for health checks
const app = express();
const WORKER_PORT = process.env.WORKER_PORT || 3002;

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'worker',
    activeJobs,
    timestamp: new Date().toISOString() 
  });
});

// ==========================================
// HYBRID RETRY SYSTEM - HELPER FUNCTIONS
// ==========================================

/**
 * Feature flag for hybrid retry system
 */
const ENABLE_HYBRID_RETRY_SYSTEM = process.env.ENABLE_HYBRID_RETRY === 'true';

/**
 * Handle failed tests with hybrid retry system
 */
async function handleFailedTestsHybrid(codingSessionId: string, failedTests: Array<{ id: string; name: string; error_message?: string; test_code?: string }>): Promise<void> {
  console.log(`[Worker] 🔄 Using Hybrid Retry System for ${failedTests.length} failed tests`);

  const { RetryStrategyService } = await import('../../backend/src/services/retryStrategyService');
  const { RetryOrchestrator } = await import('./retryOrchestrator');

  const retryStrategy = new RetryStrategyService(pool);
  const orchestrator = new RetryOrchestrator(pool);

  // Initialize retry strategy
  await retryStrategy.initializeRetryStrategy(codingSessionId, failedTests);

  // Start orchestration (non-blocking)
  orchestrator.orchestrateRetries(codingSessionId).catch(error => {
    console.error(`[Worker] Error in retry orchestration:`, error);
  });

  console.log(`[Worker] ✅ Hybrid retry orchestration started for session ${codingSessionId}`);
}

/**
 * Handle failed tests with legacy system (global refactor_attempts)
 */
async function handleFailedTestsLegacy(codingSessionId: string, testSummary: { failed: number; total: number }): Promise<void> {
  console.log(`[Worker] 🔄 Using Legacy Retry System (global refactor_attempts)`);

  // Get project path for AgentDB
  const projectResult = await pool.query(
    'SELECT base_path FROM projects WHERE id = (SELECT project_id FROM coding_sessions WHERE id = $1)',
    [codingSessionId]
  );
  const projectPath = projectResult.rows[0]?.base_path;

  // Import AgentDB managers
  const { AgentDBContextManager } = await import('../../backend/src/services/agentdb/AgentDBContextManager');
  const { AgentDBStateManager } = await import('../../backend/src/services/agentdb/AgentDBStateManager');
  const { AgentDBTraceabilityStore } = await import('../../backend/src/services/agentdb/AgentDBTraceabilityStore');

  const contextManager = new AgentDBContextManager(projectPath, codingSessionId);
  const stateManager = new AgentDBStateManager(projectPath, codingSessionId);
  const traceabilityStore = new AgentDBTraceabilityStore(projectPath, codingSessionId);

  // Get test execution details
  const testExecutionResult = await pool.query(
    `SELECT te.output, te.error_message, ts.test_code, ts.file_path, ts.name
     FROM test_executions te
     JOIN test_suites ts ON ts.id = te.test_suite_id
     WHERE te.test_suite_id IN (
       SELECT id FROM test_suites WHERE coding_session_id = $1 AND status = 'failed'
     )
     ORDER BY te.completed_at DESC`,
    [codingSessionId]
  );

  // Save failure history in AgentDB
  for (const testExec of testExecutionResult.rows) {
    await stateManager.appendHistory({
      timestamp: new Date().toISOString(),
      phase: 'refactor',
      action: `Test failed: ${testExec.name}`,
      result: 'failure',
      files_modified: [],
      error: testExec.error_message,
      test_output: testExec.output
    });
  }

  // Get current refactor attempts from AgentDB state
  const currentState = await stateManager.loadState();
  const currentRefactorAttempts = currentState?.refactor_attempts || 0;
  const refactorAttempts = currentRefactorAttempts + 1;
  const maxRefactorAttempts = 3;

  console.log(`[Worker] 📊 Current refactor attempts from AgentDB: ${currentRefactorAttempts}, new attempt: ${refactorAttempts}/${maxRefactorAttempts}`);

  if (refactorAttempts > maxRefactorAttempts) {
    // Maximum attempts reached
    await stateManager.appendHistory({
      timestamp: new Date().toISOString(),
      phase: 'refactor',
      action: 'Maximum refactoring attempts reached',
      result: 'failure',
      files_modified: []
    });

    await pool.query(
      'UPDATE coding_sessions SET status = $1, error = $2, implementation_progress = $3 WHERE id = $4',
      [
        'failed',
        `TDD cycle incomplete: ${testSummary.failed} of ${testSummary.total} test suites failed after ${maxRefactorAttempts} refactoring attempts.`,
        50,
        codingSessionId
      ]
    );

    await pool.query(
      'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
      [codingSessionId, 'error', JSON.stringify({
        message: 'TDD cycle failed: Maximum refactoring attempts reached',
        refactor_attempts: refactorAttempts - 1,
        failed_suites: testSummary.failed,
        total_suites: testSummary.total,
        action_required: 'manual_review'
      })]
    );

    console.log(`[Worker] ❌ Session ${codingSessionId} marked as failed - max refactoring attempts (${maxRefactorAttempts}) reached.`);
    return;
  }

  // Update AgentDB state with refactoring attempt
  await stateManager.updateBatch({
    current_phase: 'refactor',
    refactor_attempts: refactorAttempts,
    last_test_failure: {
      failed_count: testSummary.failed,
      total_count: testSummary.total,
      timestamp: new Date().toISOString(),
      test_outputs: testExecutionResult.rows.map((r: any) => ({
        name: r.name,
        output: r.output,
        error: r.error_message,
        file_path: r.file_path
      }))
    }
  });

  console.log(`[Worker] 💾 Saved refactor_attempts=${refactorAttempts} to AgentDB state`);

  // Continue with legacy refactoring logic...
  // (This continues with building refactor prompt and creating job - código existente)
}

app.listen(WORKER_PORT, () => {
  console.log(`Worker HTTP server listening on port ${WORKER_PORT}`);
});

// Start polling
console.log('AI Worker started');
syncActiveJobs().then(() => {
  console.log('[Worker] Active jobs synchronized, starting job polling...');
pollJobs();
});

