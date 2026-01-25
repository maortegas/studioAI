import 'dotenv/config';
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
import { jobRepo } from './repositories/aiJobRepository';
import { parseErrorsIntoActionableItems } from './utils/errorParser';
import { pool } from './db/pool';
import {
  handleImplementationOutput,
  handleTestGenerationOutput,
  insertCodingSessionErrorEvent,
  isCodingSessionPaused,
  updateCodingSessionStatusForPhase,
} from './services/codingSessionWorkerService';
import express from 'express';
import { JobDispatcher } from './core/JobDispatcher';
import { buildJobContext } from './core/JobContext';

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
      const paused = await isCodingSessionPaused(codingSessionId);
      if (paused) {
        console.log(
          `[Worker] Coding session ${codingSessionId} is paused, skipping job ${jobId}`
        );
        // Keep job as pending so it can be picked up later if resumed
        return;
      }
    }

    // Update coding session status based on phase
    if (isCodingSession) {
      await updateCodingSessionStatusForPhase(codingSessionId, {
        isTestGeneration,
        isImplementation,
        phase,
      });
      if (isTestGeneration) {
        console.log(
          `[Worker] Test generation started for coding session ${codingSessionId}`
        );
      } else if (isImplementation) {
        if (phase === 'tdd_all_at_once') {
          console.log(
            `[Worker] TDD all-at-once implementation started for coding session ${codingSessionId}`
          );
        } else {
          console.log(
            `[Worker] Implementation started for coding session ${codingSessionId}`
          );
        }
      }
    }

    // Set up event handlers
    cli.on('output', async (data: string) => {
      await jobRepo.addEvent(jobId, 'progress', { output: data });

      // Update coding session with output
      if (isCodingSession) {
        try {
          if (isTestGeneration) {
            await handleTestGenerationOutput(codingSessionId, data);
          } else if (isImplementation) {
            await handleImplementationOutput(codingSessionId, data);
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
          await insertCodingSessionErrorEvent(codingSessionId, data);
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

    // ============================================================
    // Dispatcher Integration (Handler Architecture)
    // ============================================================
    if (!USE_NEW_HANDLERS || !dispatcher) {
      throw new Error('Legacy processJob() has been removed. USE_NEW_HANDLERS must be true.');
    }

    console.log(`[Worker] Dispatching job ${jobId} to handler`);

    // Build job context
    const context = buildJobContext(job, pool, projectPath);

    // Dispatch to appropriate handler
    const handlerResult = await dispatcher.dispatch(context, {
      success: result.success,
      output: result.output,
      error: result.error,
    });

    // Update job status based on handler result
    if (handlerResult.success) {
      console.log(`[Worker] ✅ Job ${jobId} completed successfully`);
      await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
    } else {
      console.error(`[Worker] ❌ Job ${jobId} failed:`, handlerResult.error);
      await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
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

// ============================================================
// Initialize Job Dispatcher (New Handler Architecture)
// ============================================================
const USE_NEW_HANDLERS = process.env.USE_NEW_HANDLERS === 'true';
let dispatcher: JobDispatcher | null = null;

if (USE_NEW_HANDLERS) {
  console.log('[Worker] 🚀 Using NEW handler architecture');
  dispatcher = new JobDispatcher(pool, jobRepo);
  console.log(`[Worker] Registered ${dispatcher.getHandlerCount()} handlers:`, dispatcher.getHandlerNames());
} else {
  console.log('[Worker] Using LEGACY processJob() logic');
}

// Start polling
console.log('AI Worker started');
syncActiveJobs().then(() => {
  console.log('[Worker] Active jobs synchronized, starting job polling...');
pollJobs();
});

