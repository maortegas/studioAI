import 'dotenv/config';
import { Pool } from 'pg';
import { CursorCLI } from './cli/cursor';
import { ClaudeCLI } from './cli/claude';
import { AIProvider, AIMode, AIJobStatus } from '@devflow-studio/shared';
import path from 'path';
import fs from 'fs/promises';

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
    const phase = job.args.phase; // 'test_generation' or 'implementation'
    const isCodingSession = mode === 'agent' && codingSessionId;
    const isTestGeneration = isCodingSession && phase === 'test_generation';
    const isImplementation = isCodingSession && phase === 'implementation';
    
    // Check if this is a QA session job
    const qaSessionId = job.args.qa_session_id;
    const isQASession = mode === 'agent' && qaSessionId;

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
      await pool.query(
        'UPDATE coding_sessions SET status = $1 WHERE id = $2',
        ['running', codingSessionId]
      );
      console.log(`[Worker] Implementation started for coding session ${codingSessionId}`);
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
            
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'output', JSON.stringify({ output: data, test_progress: newTestProgress })]
            );
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
            
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'output', JSON.stringify({ output: data, implementation_progress: newImplProgress, progress: totalProgress })]
            );
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
          await pool.query(
            'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
            [codingSessionId, 'error', JSON.stringify({ error: data })]
          );
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

    // Update status
    if (result.success) {
      await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
      await jobRepo.addEvent(jobId, 'completed', { output: result.output });
      
      // Handle coding session completion based on phase
      if (isTestGeneration) {
        // Test generation completed - save tests and start implementation
        try {
          const sessionResult = await pool.query(
            'SELECT project_id, story_id, programmer_type FROM coding_sessions WHERE id = $1',
            [codingSessionId]
          );
          
          if (sessionResult.rows.length > 0) {
            const session = sessionResult.rows[0];
            
            // Parse generated tests and create test suites
            const testSuites = await parseAndSaveTestSuites(
              session.project_id,
              codingSessionId,
              session.story_id,
              result.output,
              session.programmer_type
            );
            
            // Save tests output and mark tests as generated
            await pool.query(
              'UPDATE coding_sessions SET status = $1, test_progress = $2, progress = $3, tests_output = $4 WHERE id = $5',
              ['tests_generated', 50, 50, result.output, codingSessionId]
            );
            
            await pool.query(
              'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
              [codingSessionId, 'tests_generated', JSON.stringify({ 
                tests_output: result.output, 
                test_suites: testSuites.map(ts => ts.id),
                message: `Generated ${testSuites.length} test suites successfully` 
              })]
            );
            
            console.log(`[Worker] Generated ${testSuites.length} test suites for coding session ${codingSessionId}`);
            
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
        } catch (error) {
          console.error('[Worker] Error processing test generation completion:', error);
        }
      } else if (isImplementation) {
        // Implementation completed - mark session as done and trigger QA
        try {
          await pool.query(
            'UPDATE coding_sessions SET status = $1, implementation_progress = $2, progress = $3, completed_at = $4 WHERE id = $5',
            ['completed', 50, 100, new Date(), codingSessionId]
          );
          await pool.query(
            'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
            [codingSessionId, 'completed', JSON.stringify({ message: 'Implementation completed successfully' })]
          );
          console.log(`[Worker] Coding session ${codingSessionId} completed`);
          
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
        } catch (error) {
          console.error('[Worker] Error completing coding session:', error);
        }
      }
      
      // Auto-save artifacts based on job type
      const jobArgs = job.args || {};
      const prompt = jobArgs.prompt || '';
      
      // Save Architecture
      if (prompt.includes('architecture documentation') || prompt.includes('Architecture') || 
          prompt.includes('System Architecture Overview')) {
        try {
          // Get project to find base_path
          const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [job.project_id]);
          if (projectResult.rows.length > 0) {
            const project = projectResult.rows[0];
            const architecturePath = path.join(project.base_path, 'artifacts', 'ARCHITECTURE.md');
            
            // Ensure artifacts directory exists
            await fs.mkdir(path.dirname(architecturePath), { recursive: true });
            
            // Save architecture file
            await fs.writeFile(architecturePath, result.output, 'utf8');
            
            // Save to database
            const artifactResult = await pool.query(
              `INSERT INTO artifacts (project_id, type, path, content)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING
               RETURNING *`,
              [job.project_id, 'architecture', architecturePath, JSON.stringify({ content: result.output })]
            );
            
            // If artifact already exists, update it
            if (artifactResult.rows.length === 0) {
              await pool.query(
                `UPDATE artifacts 
                 SET content = $1, path = $2 
                 WHERE project_id = $3 AND type = 'architecture'`,
                [JSON.stringify({ content: result.output }), architecturePath, job.project_id]
              );
            }
            
            console.log(`Architecture saved automatically for project ${job.project_id}`);
          }
        } catch (error: any) {
          console.error(`Failed to auto-save architecture: ${error.message}`);
          // Don't fail the job if auto-save fails
        }
      }
      
      // Process QA results
      if (isQASession) {
        console.log(`[Worker] Processing QA session ${qaSessionId}, phase: ${job.args.phase || 'execution'}`);
        try {
          const qaPhase = job.args.phase; // 'test_generation' or undefined (run tests)
          
          if (qaPhase === 'test_generation') {
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
              const testDir = path.join(project.base_path, 'artifacts', `TESTS_${qaSessionId}`);
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
                  ['completed', `artifacts/TESTS_${qaSessionId}/all_tests.js`, new Date(), qaSessionId]
                );
                console.log(`All test generation completed for QA session ${qaSessionId} (${totalStories} stories)`);
              } else {
                console.log(`Test generation progress for QA session ${qaSessionId}: ${totalStories - remainingCount}/${totalStories} completed`);
              }
            }
          } else {
            // This is full QA execution - parse and save results
            const jsonMatch = result.output.match(/```json\s*([\s\S]*?)\s*```/) || 
                             result.output.match(/\{[\s\S]*\}/);
            
            if (!jsonMatch) {
              throw new Error('No JSON found in QA output');
            }

            const qaData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            const summary = qaData.summary || {};
            const tests = qaData.tests || [];

            // Save test results
            for (const test of tests) {
              await pool.query(
                `INSERT INTO test_results (session_id, test_name, test_type, status, duration, error_message, output)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  qaSessionId,
                  test.name || 'Unknown test',
                  test.type || 'unit',
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
              const reportPath = path.join(project.base_path, 'artifacts', `QA_REPORT_${qaSessionId}.json`);
              await fs.mkdir(path.dirname(reportPath), { recursive: true });
              await fs.writeFile(reportPath, JSON.stringify(qaData, null, 2), 'utf8');
              
              await pool.query(
                'UPDATE qa_sessions SET report_path = $1 WHERE id = $2',
                [`artifacts/QA_REPORT_${qaSessionId}.json`, qaSessionId]
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
            const roadmapPath = path.join(project.base_path, 'artifacts', 'ROADMAP.md');
            
            // Ensure artifacts directory exists
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
              [job.project_id, 'roadmap', 'artifacts/ROADMAP.md', JSON.stringify(roadmapContent)]
            );
            
            // If artifact already exists, update it
            if (artifactResult.rows.length === 0) {
              await pool.query(
                `UPDATE artifacts 
                 SET content = $1, path = $2 
                 WHERE project_id = $3 AND type = 'roadmap'`,
                [JSON.stringify(roadmapContent), 'artifacts/ROADMAP.md', job.project_id]
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
async function parseAndSaveTestSuites(
  projectId: string,
  codingSessionId: string,
  storyId: string | null,
  aiOutput: string,
  programmerType: string
): Promise<any[]> {
  const testSuites: any[] = [];
  
  try {
    // Get project to find base_path
    const projectResult = await pool.query('SELECT base_path FROM projects WHERE id = $1', [projectId]);
    if (projectResult.rows.length === 0) {
      throw new Error('Project not found');
    }
    const project = projectResult.rows[0];
    
    // Create tests directory for this session
    const testsDir = path.join(project.base_path, 'tests', `session_${codingSessionId}`);
    await fs.mkdir(testsDir, { recursive: true });
    
    // Parse test code from AI output
    // Look for code blocks with test code
    const codeBlockRegex = /```(?:javascript|js|typescript|ts|test)?\s*\n([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let match;
    
    while ((match = codeBlockRegex.exec(aiOutput)) !== null) {
      codeBlocks.push(match[1]);
    }
    
    // If no code blocks found, try to extract the entire output as test code
    if (codeBlocks.length === 0) {
      // Try to find test patterns in the output
      const testPattern = /(describe|it|test|suite|beforeEach|afterEach)[\s\S]*/i;
      const testMatch = aiOutput.match(testPattern);
      if (testMatch) {
        codeBlocks.push(aiOutput);
      } else {
        // Fallback: use entire output
        codeBlocks.push(aiOutput);
      }
    }
    
    // Determine test type based on content and programmer type
    const detectTestType = (code: string): 'unit' | 'integration' | 'e2e' => {
      const lowerCode = code.toLowerCase();
      if (lowerCode.includes('e2e') || lowerCode.includes('end-to-end') || lowerCode.includes('cypress') || lowerCode.includes('playwright')) {
        return 'e2e';
      }
      if (lowerCode.includes('integration') || lowerCode.includes('api') || lowerCode.includes('endpoint')) {
        return 'integration';
      }
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
    for (const [typeKey, suiteData] of testSuitesByType.entries()) {
      const [testType] = typeKey.split('_');
      const fileName = `${typeKey}.test.js`;
      const filePath = path.join(testsDir, fileName);
      
      // Save test file
      await fs.writeFile(filePath, suiteData.code, 'utf8');
      
      // Create test suite in database
      const suiteResult = await pool.query(
        `INSERT INTO test_suites (project_id, coding_session_id, story_id, name, description, test_type, status, file_path, test_code, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          projectId,
          codingSessionId,
          storyId,
          suiteData.name,
          `Generated ${testType} tests for coding session ${codingSessionId}`,
          testType as 'unit' | 'integration' | 'e2e',
          'ready',
          `tests/session_${codingSessionId}/${fileName}`,
          suiteData.code,
          new Date()
        ]
      );
      
      testSuites.push(suiteResult.rows[0]);
    }
    
    console.log(`[Worker] Created ${testSuites.length} test suite(s) for coding session ${codingSessionId}`);
  } catch (error: any) {
    console.error('[Worker] Error parsing and saving test suites:', error);
    throw error;
  }
  
  return testSuites;
}

// Helper function to execute all test suites for a coding session
async function executeTestSuitesForSession(codingSessionId: string): Promise<void> {
  try {
    // Get all test suites for this session
    const suitesResult = await pool.query(
      'SELECT id, project_id, test_type, file_path, test_code FROM test_suites WHERE coding_session_id = $1 AND status = $2',
      [codingSessionId, 'ready']
    );
    
    if (suitesResult.rows.length === 0) {
      console.log(`[Worker] No test suites found for coding session ${codingSessionId}`);
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
        
        // Note: Actual test execution would require spawning a process
        // For now, we'll mark it as a placeholder that needs implementation
        // In a real scenario, you'd use child_process.spawn to run the tests
        
        console.log(`[Worker] Test execution for suite ${suite.id} would run: ${testCommand} ${testArgs.join(' ')}`);
        console.log(`[Worker] Note: Actual test execution requires process spawning implementation`);
        
        // For now, mark as skipped (actual implementation would run tests and parse results)
        await pool.query(
          `UPDATE test_executions 
           SET status = $1, completed_at = $2, duration = $3, total_tests = $4, passed_tests = $4, skipped_tests = $5, output = $6
           WHERE id = $7`,
          ['skipped', new Date(), 0, 0, 0, 'Test execution not yet implemented - requires process spawning', executionId]
        );
        
        await pool.query(
          'UPDATE test_suites SET status = $1, executed_at = $2 WHERE id = $3',
          ['skipped', new Date(), suite.id]
        );
        
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
      }
    }
    
    console.log(`[Worker] Completed test execution for coding session ${codingSessionId}`);
  } catch (error: any) {
    console.error('[Worker] Error executing test suites for session:', error);
    throw error;
  }
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

// Start polling
console.log('AI Worker started');
syncActiveJobs().then(() => {
  console.log('[Worker] Active jobs synchronized, starting job polling...');
  pollJobs();
});

