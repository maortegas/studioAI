const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

async function fixCompletedWithError() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Find sessions that are "completed" but have errors
    const sessionsResult = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.error,
        cs.completed_at,
        t.title as task_title
      FROM coding_sessions cs
      JOIN tasks t ON t.id = cs.story_id
      WHERE cs.status = 'completed' 
        AND cs.error IS NOT NULL
        AND cs.error != ''
      ORDER BY cs.created_at DESC
      LIMIT 10
    `);

    console.log('📋 Sessions "completed" con errores:');
    console.log(`Total: ${sessionsResult.rows.length}\n`);
    
    if (sessionsResult.rows.length > 0) {
      for (const session of sessionsResult.rows) {
        console.log(`Session: ${session.task_title}`);
        console.log(`   ID: ${session.id}`);
        console.log(`   Status: ${session.status}`);
        console.log(`   Error: ${session.error}`);
        console.log(`   Completed: ${session.completed_at}`);
        
        // Update to failed if it has an error
        if (session.error && session.error.trim() !== '') {
          console.log('   🔧 Actualizando a "failed"...');
          await client.query(`
            UPDATE coding_sessions
            SET status = 'failed',
                updated_at = NOW()
            WHERE id = $1
          `, [session.id]);
          console.log('   ✅ Actualizado a "failed"');
        }
        console.log('');
      }
    } else {
      console.log('   No hay sessions con errores\n');
    }

    // Also check for "running" sessions that should be updated
    const runningSessionsResult = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.error,
        cs.completed_at,
        cs.progress,
        t.title as task_title
      FROM coding_sessions cs
      JOIN tasks t ON t.id = cs.story_id
      WHERE cs.status = 'running'
      ORDER BY cs.created_at DESC
    `);

    console.log('📋 Sessions con status "running":');
    console.log(`Total: ${runningSessionsResult.rows.length}\n`);
    
    if (runningSessionsResult.rows.length > 0) {
      for (const session of runningSessionsResult.rows) {
        console.log(`Session: ${session.task_title}`);
        console.log(`   ID: ${session.id}`);
        console.log(`   Progress: ${session.progress}%`);
        console.log(`   Completed: ${session.completed_at || 'Not completed'}`);
        console.log(`   Error: ${session.error || 'None'}`);
        
        // Check if there are any active jobs
        const activeJobsResult = await client.query(`
          SELECT COUNT(*) as count
          FROM ai_jobs
          WHERE args->>'coding_session_id' = $1
            AND status IN ('pending', 'running')
        `, [session.id]);
        
        const hasActiveJobs = parseInt(activeJobsResult.rows[0].count) > 0;
        console.log(`   Active Jobs: ${hasActiveJobs}`);
        
        // If completed_at exists and no active jobs, should be completed or failed
        if (session.completed_at && !hasActiveJobs) {
          const newStatus = session.error ? 'failed' : 'completed';
          console.log(`   🔧 Actualizando a "${newStatus}"...`);
          await client.query(`
            UPDATE coding_sessions
            SET status = $1,
                updated_at = NOW()
            WHERE id = $2
          `, [newStatus, session.id]);
          console.log(`   ✅ Actualizado a "${newStatus}"`);
        }
        console.log('');
      }
    } else {
      console.log('   No hay sessions en "running"\n');
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixCompletedWithError();

