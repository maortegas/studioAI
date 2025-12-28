const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

async function checkRecentJobs() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check recent jobs for the specific session
    const sessionId = '094a7d45-e9c2-4e4c-8fa9-fdaaf221a45c';
    
    const jobsResult = await client.query(`
      SELECT 
        id, 
        project_id, 
        provider, 
        command, 
        status, 
        started_at, 
        finished_at,
        created_at,
        args->>'phase' as phase,
        args->>'refactor_attempt' as refactor_attempt,
        args->>'coding_session_id' as coding_session_id
      FROM ai_jobs 
      WHERE args->>'coding_session_id' = $1
      ORDER BY created_at DESC 
      LIMIT 10
    `, [sessionId]);

    console.log(`📋 Jobs recientes para session ${sessionId}:`);
    console.log(`Total: ${jobsResult.rows.length}\n`);
    
    if (jobsResult.rows.length > 0) {
      jobsResult.rows.forEach((job, i) => {
        console.log(`${i + 1}. Job ID: ${job.id}`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Phase: ${job.phase || 'N/A'}`);
        console.log(`   Refactor Attempt: ${job.refactor_attempt || 'N/A'}`);
        console.log(`   Created: ${job.created_at}`);
        console.log(`   Started: ${job.started_at || 'Not started'}`);
        console.log(`   Finished: ${job.finished_at || 'Not finished'}`);
        if (job.finished_at && job.started_at) {
          const duration = new Date(job.finished_at) - new Date(job.started_at);
          console.log(`   Duration: ${(duration / 1000 / 60).toFixed(2)} minutes`);
        }
        console.log('');
      });
    } else {
      console.log('   No hay jobs para esta session\n');
    }

    // Check the specific session
    const sessionResult = await client.query(`
      SELECT 
        id, 
        project_id, 
        story_id, 
        status, 
        ai_job_id,
        started_at, 
        completed_at,
        created_at,
        error
      FROM coding_sessions 
      WHERE id = $1
    `, [sessionId]);

    if (sessionResult.rows.length > 0) {
      const session = sessionResult.rows[0];
      console.log(`📋 Detalles de la session ${sessionId}:`);
      console.log(`   Status: ${session.status}`);
      console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
      console.log(`   Started: ${session.started_at || 'Not started'}`);
      console.log(`   Completed: ${session.completed_at || 'Not completed'}`);
      console.log(`   Error: ${session.error || 'None'}`);
      console.log('');
    }

    // Check all recent jobs (last 20)
    const allJobsResult = await client.query(`
      SELECT 
        id, 
        status, 
        started_at, 
        finished_at,
        created_at,
        args->>'phase' as phase,
        args->>'coding_session_id' as coding_session_id
      FROM ai_jobs 
      ORDER BY created_at DESC 
      LIMIT 20
    `);

    console.log(`📋 Últimos 20 jobs (todas las sessions):`);
    console.log(`Total: ${allJobsResult.rows.length}\n`);
    
    allJobsResult.rows.forEach((job, i) => {
      console.log(`${i + 1}. Job ID: ${job.id.substring(0, 8)}...`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Phase: ${job.phase || 'N/A'}`);
      console.log(`   Session: ${job.coding_session_id ? (job.coding_session_id.substring(0, 8) + '...') : 'N/A'}`);
      console.log(`   Created: ${job.created_at}`);
      console.log(`   Started: ${job.started_at || 'Not started'}`);
      console.log(`   Finished: ${job.finished_at || 'Not finished'}`);
      console.log('');
    });

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkRecentJobs();

