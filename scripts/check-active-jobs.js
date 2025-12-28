const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

async function checkActiveJobs() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check active AI jobs
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
        args->>'refactor_attempt' as refactor_attempt
      FROM ai_jobs 
      WHERE status IN ('pending', 'running') 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log('📋 AI Jobs activos/pendientes:');
    console.log(`Total: ${jobsResult.rows.length}\n`);
    
    if (jobsResult.rows.length > 0) {
      jobsResult.rows.forEach((job, i) => {
        console.log(`${i + 1}. Job ID: ${job.id}`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Provider: ${job.provider}`);
        console.log(`   Command: ${job.command}`);
        console.log(`   Phase: ${job.phase || 'N/A'}`);
        console.log(`   Refactor Attempt: ${job.refactor_attempt || 'N/A'}`);
        console.log(`   Started: ${job.started_at || 'Not started'}`);
        console.log(`   Created: ${job.created_at}`);
        console.log('');
      });
    } else {
      console.log('   No hay jobs activos\n');
    }

    // Check active coding sessions
    const sessionsResult = await client.query(`
      SELECT 
        id, 
        project_id, 
        story_id, 
        status, 
        ai_job_id,
        started_at, 
        completed_at,
        created_at
      FROM coding_sessions 
      WHERE status IN ('running', 'tdd_refactoring', 'tdd_implementing', 'tdd_ready', 'tdd_green') 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log('📋 Coding Sessions activas:');
    console.log(`Total: ${sessionsResult.rows.length}\n`);
    
    if (sessionsResult.rows.length > 0) {
      sessionsResult.rows.forEach((session, i) => {
        console.log(`${i + 1}. Session ID: ${session.id}`);
        console.log(`   Status: ${session.status}`);
        console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
        console.log(`   Started: ${session.started_at || 'Not started'}`);
        console.log(`   Created: ${session.created_at}`);
        console.log('');
      });
    } else {
      console.log('   No hay sessions activas\n');
    }

    // Check for stuck jobs (running for more than 1 hour)
    const stuckJobsResult = await client.query(`
      SELECT 
        id, 
        status, 
        started_at,
        EXTRACT(EPOCH FROM (NOW() - started_at))/3600 as hours_running
      FROM ai_jobs 
      WHERE status = 'running' 
        AND started_at IS NOT NULL
        AND started_at < NOW() - INTERVAL '1 hour'
      ORDER BY started_at ASC
    `);

    if (stuckJobsResult.rows.length > 0) {
      console.log('⚠️  Jobs posiblemente bloqueados (>1 hora):');
      stuckJobsResult.rows.forEach((job, i) => {
        console.log(`${i + 1}. Job ID: ${job.id}`);
        console.log(`   Running for: ${job.hours_running.toFixed(2)} hours`);
        console.log(`   Started: ${job.started_at}`);
        console.log('');
      });
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkActiveJobs();

