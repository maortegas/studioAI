const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

async function checkSessionStatus() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Find the session that matches "Implement retry logic for failed WhatsApp messages"
    const sessionResult = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.progress,
        cs.implementation_progress,
        cs.ai_job_id,
        cs.started_at,
        cs.completed_at,
        cs.error,
        cs.created_at,
        t.title as task_title
      FROM coding_sessions cs
      JOIN tasks t ON t.id = cs.story_id
      WHERE t.title LIKE '%retry logic%' OR t.title LIKE '%WhatsApp%'
      ORDER BY cs.created_at DESC
      LIMIT 5
    `);

    console.log('📋 Sessions relacionadas con "retry logic" o "WhatsApp":');
    console.log(`Total: ${sessionResult.rows.length}\n`);
    
    if (sessionResult.rows.length > 0) {
      for (const session of sessionResult.rows) {
        console.log(`Session ID: ${session.id}`);
        console.log(`   Task: ${session.task_title}`);
        console.log(`   Status: ${session.status}`);
        console.log(`   Progress: ${session.progress}%`);
        console.log(`   Implementation Progress: ${session.implementation_progress}%`);
        console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
        console.log(`   Started: ${session.started_at || 'Not started'}`);
        console.log(`   Completed: ${session.completed_at || 'Not completed'}`);
        console.log(`   Error: ${session.error || 'None'}`);
        console.log(`   Created: ${session.created_at}`);
        
        // Check if there's an active job for this session
        if (session.ai_job_id) {
          const jobResult = await client.query(`
            SELECT id, status, started_at, finished_at, args->>'phase' as phase
            FROM ai_jobs
            WHERE id = $1
          `, [session.ai_job_id]);
          
          if (jobResult.rows.length > 0) {
            const job = jobResult.rows[0];
            console.log(`   Associated Job Status: ${job.status}`);
            console.log(`   Job Phase: ${job.phase || 'N/A'}`);
            console.log(`   Job Started: ${job.started_at || 'Not started'}`);
            console.log(`   Job Finished: ${job.finished_at || 'Not finished'}`);
          }
        }
        
        // Check for any recent jobs for this session
        const recentJobsResult = await client.query(`
          SELECT id, status, started_at, finished_at, args->>'phase' as phase
          FROM ai_jobs
          WHERE args->>'coding_session_id' = $1
          ORDER BY created_at DESC
          LIMIT 3
        `, [session.id]);
        
        if (recentJobsResult.rows.length > 0) {
          console.log(`   Recent Jobs (${recentJobsResult.rows.length}):`);
          recentJobsResult.rows.forEach((job, i) => {
            console.log(`     ${i + 1}. Job ${job.id.substring(0, 8)}... - Status: ${job.status}, Phase: ${job.phase || 'N/A'}`);
          });
        }
        
        console.log('');
      }
    } else {
      console.log('   No se encontraron sessions\n');
    }

    // Check all running sessions
    const runningSessionsResult = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.progress,
        cs.ai_job_id,
        t.title as task_title
      FROM coding_sessions cs
      JOIN tasks t ON t.id = cs.story_id
      WHERE cs.status = 'running'
      ORDER BY cs.created_at DESC
    `);

    console.log('📋 Todas las sessions con status "running":');
    console.log(`Total: ${runningSessionsResult.rows.length}\n`);
    
    runningSessionsResult.rows.forEach((session, i) => {
      console.log(`${i + 1}. ${session.task_title}`);
      console.log(`   Session ID: ${session.id}`);
      console.log(`   Progress: ${session.progress}%`);
      console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
      console.log('');
    });

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkSessionStatus();

