const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

async function fixStuckSession() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const sessionId = '094a7d45-e9c2-4e4c-8fa9-fdaaf221a45c';

    // Check current status
    const currentStatus = await client.query(`
      SELECT id, status, progress, error, completed_at, ai_job_id
      FROM coding_sessions
      WHERE id = $1
    `, [sessionId]);

    if (currentStatus.rows.length === 0) {
      console.log('❌ Session not found');
      await client.end();
      return;
    }

    const session = currentStatus.rows[0];
    console.log('📋 Current session status:');
    console.log(`   Status: ${session.status}`);
    console.log(`   Progress: ${session.progress}%`);
    console.log(`   Error: ${session.error || 'None'}`);
    console.log(`   Completed: ${session.completed_at || 'Not completed'}`);
    console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
    console.log('');

    // Check if all jobs are completed
    const jobsResult = await client.query(`
      SELECT id, status, finished_at
      FROM ai_jobs
      WHERE args->>'coding_session_id' = $1
      ORDER BY created_at DESC
    `, [sessionId]);

    console.log(`📋 Jobs para esta session: ${jobsResult.rows.length}`);
    const allCompleted = jobsResult.rows.every(job => job.status === 'completed' || job.status === 'failed');
    const hasActiveJobs = jobsResult.rows.some(job => job.status === 'pending' || job.status === 'running');
    
    console.log(`   Todos completados: ${allCompleted}`);
    console.log(`   Tiene jobs activos: ${hasActiveJobs}`);
    console.log('');

    if (session.status === 'running' && allCompleted && !hasActiveJobs) {
      console.log('🔧 Actualizando session a "failed" porque tiene error y todos los jobs están completados...');
      
      await client.query(`
        UPDATE coding_sessions
        SET status = 'failed',
            updated_at = NOW()
        WHERE id = $1
      `, [sessionId]);

      console.log('✅ Session actualizada a "failed"');
      
      // Verify
      const updatedStatus = await client.query(`
        SELECT id, status, updated_at
        FROM coding_sessions
        WHERE id = $1
      `, [sessionId]);

      if (updatedStatus.rows.length > 0) {
        console.log(`   Nuevo status: ${updatedStatus.rows[0].status}`);
        console.log(`   Updated at: ${updatedStatus.rows[0].updated_at}`);
      }
    } else {
      console.log('⚠️  No se actualizó la session porque:');
      if (session.status !== 'running') {
        console.log(`   - Status no es "running" (es "${session.status}")`);
      }
      if (!allCompleted) {
        console.log('   - No todos los jobs están completados');
      }
      if (hasActiveJobs) {
        console.log('   - Hay jobs activos');
      }
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixStuckSession();

