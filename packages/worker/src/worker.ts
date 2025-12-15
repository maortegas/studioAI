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

    // Set up event handlers
    cli.on('output', (data: string) => {
      jobRepo.addEvent(jobId, 'progress', { output: data });
    });

    cli.on('error', (data: string) => {
      jobRepo.addEvent(jobId, 'error', { error: data });
    });

    // Execute CLI command with complete PRD in prompt
    // The prompt contains the full PRD (idea del proyecto) as context
    console.log(`[Worker] Executing ${provider} CLI command for job ${jobId}`);
    console.log(`[Worker] Prompt includes PRD: ${prompt.includes('PRD') || prompt.includes('Product Requirements Document')}`);
    console.log(`[Worker] Prompt length: ${prompt.length} characters`);
    
    const result = await cli.execute(mode, prompt, projectPath, { timeout: 300000 }); // 5 min timeout
    
    console.log(`[Worker] CLI execution completed. Success: ${result.success}`);
    if (result.output) {
      console.log(`[Worker] Output length: ${result.output.length} characters`);
    }

    // Update status
    if (result.success) {
      await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
      await jobRepo.addEvent(jobId, 'completed', { output: result.output });
      
      // If this is an architecture generation job, save it automatically
      // Check if the job args contain architecture generation context
      const jobArgs = job.args || {};
      const prompt = jobArgs.prompt || '';
      
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
    } else {
      await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
      await jobRepo.addEvent(jobId, 'failed', { error: result.error });
    }
  } catch (error: any) {
    console.error(`Error processing job ${jobId}:`, error);
    await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
    await jobRepo.addEvent(jobId, 'failed', { error: error.message });
  }
}

// Poll for pending jobs
async function pollJobs() {
  try {
    const result = await pool.query(
      "SELECT id FROM ai_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    );

    if (result.rows.length > 0) {
      const jobId = result.rows[0].id;
      await processJob(jobId);
    }
  } catch (error) {
    console.error('Error polling jobs:', error);
  }

  // Poll again after 2 seconds
  setTimeout(pollJobs, 2000);
}

// Start polling
console.log('AI Worker started');
pollJobs();

