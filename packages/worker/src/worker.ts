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
    const isCodingSession = mode === 'agent' && codingSessionId;

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

    // Update coding session status to running
    if (isCodingSession) {
      await pool.query(
        'UPDATE coding_sessions SET status = $1, started_at = $2 WHERE id = $3',
        ['running', new Date(), codingSessionId]
      );
      console.log(`[Worker] Coding session ${codingSessionId} started`);
    }

    // Set up event handlers
    cli.on('output', async (data: string) => {
      await jobRepo.addEvent(jobId, 'progress', { output: data });
      
      // Update coding session with output
      if (isCodingSession) {
        try {
          const result = await pool.query(
            'SELECT output FROM coding_sessions WHERE id = $1',
            [codingSessionId]
          );
          const currentOutput = result.rows[0]?.output || '';
          await pool.query(
            'UPDATE coding_sessions SET output = $1 WHERE id = $2',
            [currentOutput + data, codingSessionId]
          );
          
          // Add event to coding_session_events
          await pool.query(
            'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
            [codingSessionId, 'output', JSON.stringify({ output: data })]
          );
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
    
    const result = await cli.execute(mode, prompt, projectPath, { timeout: 300000 }); // 5 min timeout
    
    console.log(`[Worker] CLI execution completed. Success: ${result.success}`);
    if (result.output) {
      console.log(`[Worker] Output length: ${result.output.length} characters`);
    }

    // Update status
    if (result.success) {
      await jobRepo.updateStatus(jobId, 'completed', undefined, new Date());
      await jobRepo.addEvent(jobId, 'completed', { output: result.output });
      
      // Update coding session to completed
      if (isCodingSession) {
        try {
          await pool.query(
            'UPDATE coding_sessions SET status = $1, progress = $2, completed_at = $3 WHERE id = $4',
            ['completed', 100, new Date(), codingSessionId]
          );
          await pool.query(
            'INSERT INTO coding_session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
            [codingSessionId, 'completed', JSON.stringify({ message: 'Coding completed successfully' })]
          );
          console.log(`[Worker] Coding session ${codingSessionId} completed`);
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
    }
  } catch (error: any) {
    console.error(`Error processing job ${jobId}:`, error);
    await jobRepo.updateStatus(jobId, 'failed', undefined, new Date());
    await jobRepo.addEvent(jobId, 'failed', { error: error.message });
    
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

// Poll for pending jobs
async function pollJobs() {
  try {
    // Get pending jobs, excluding those with paused coding sessions
    const result = await pool.query(
      `SELECT aj.id 
       FROM ai_jobs aj
       LEFT JOIN coding_sessions cs ON cs.ai_job_id = aj.id
       WHERE aj.status = 'pending' 
       AND (cs.id IS NULL OR cs.status != 'paused')
       ORDER BY aj.created_at ASC 
       LIMIT 1`
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

// Start polling
console.log('AI Worker started');
pollJobs();

