const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

const sessionId = '2adeb090-99b3-4431-bb8b-f0deb1b839ff';

async function fixPrismaPendingSession() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Obtener información de la sesión
    const sessionResult = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.progress,
        cs.ai_job_id,
        cs.test_generation_job_id,
        cs.implementation_job_id,
        cs.started_at,
        cs.completed_at,
        cs.created_at,
        cs.error,
        cs.project_id,
        t.title as task_title
      FROM coding_sessions cs
      JOIN tasks t ON t.id = cs.story_id
      WHERE cs.id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      console.log('❌ Session not found');
      await client.end();
      return;
    }

    const session = sessionResult.rows[0];
    console.log('📋 Información de la sesión:');
    console.log(`   ID: ${session.id}`);
    console.log(`   Task: ${session.task_title}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Progress: ${session.progress}%`);
    console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
    console.log(`   Test Generation Job ID: ${session.test_generation_job_id || 'N/A'}`);
    console.log(`   Implementation Job ID: ${session.implementation_job_id || 'N/A'}`);
    console.log(`   Started: ${session.started_at || 'Not started'}`);
    console.log(`   Error: ${session.error || 'None'}`);
    console.log('');

    // Buscar todos los jobs relacionados con esta sesión
    const jobIds = [
      session.ai_job_id,
      session.test_generation_job_id,
      session.implementation_job_id
    ].filter(id => id);

    let jobsQuery = `
      SELECT 
        aj.id,
        aj.status,
        aj.provider,
        aj.command,
        aj.args->>'phase' as phase,
        aj.started_at,
        aj.finished_at,
        aj.created_at
      FROM ai_jobs aj
      WHERE aj.args->>'coding_session_id' = $1
    `;
    
    const params = [sessionId];
    
    if (jobIds.length > 0) {
      jobsQuery += ` OR aj.id = ANY($2::uuid[])`;
      params.push(jobIds);
    }
    
    jobsQuery += ` ORDER BY aj.created_at DESC`;
    
    const jobsResult = await client.query(jobsQuery, params);

    console.log(`📋 Jobs relacionados: ${jobsResult.rows.length}\n`);
    
    if (jobsResult.rows.length > 0) {
      jobsResult.rows.forEach((job, i) => {
        console.log(`${i + 1}. Job ID: ${job.id.substring(0, 8)}...`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Phase: ${job.phase || 'N/A'}`);
        console.log(`   Provider: ${job.provider}`);
        console.log(`   Started: ${job.started_at || 'Not started'}`);
        console.log(`   Finished: ${job.finished_at || 'Not finished'}`);
        console.log(`   Created: ${job.created_at}`);
        console.log('');
      });
    }

    // Verificar si hay jobs pendientes
    const pendingJobs = jobsResult.rows.filter(job => job.status === 'pending');
    const runningJobs = jobsResult.rows.filter(job => job.status === 'running');
    const completedJobs = jobsResult.rows.filter(job => job.status === 'completed');
    const failedJobs = jobsResult.rows.filter(job => job.status === 'failed');

    console.log('📊 Resumen de jobs:');
    console.log(`   Pending: ${pendingJobs.length}`);
    console.log(`   Running: ${runningJobs.length}`);
    console.log(`   Completed: ${completedJobs.length}`);
    console.log(`   Failed: ${failedJobs.length}`);
    console.log('');

    // Si la sesión está en pending pero no hay jobs pendientes, puede necesitar reactivación
    if (session.status === 'pending' && pendingJobs.length === 0 && runningJobs.length === 0) {
      console.log('⚠️  Sesión en estado "pending" pero sin jobs pendientes o corriendo');
      console.log('   Esto puede indicar que la sesión está bloqueada\n');

      // Verificar si todos los jobs están completados
      if (completedJobs.length > 0 && failedJobs.length === 0) {
        console.log('✅ Todos los jobs están completados. Actualizando sesión a "completed"...');
        
        await client.query('BEGIN');
        try {
          await client.query(`
            UPDATE coding_sessions 
            SET status = 'completed',
                progress = 100,
                completed_at = NOW()
            WHERE id = $1
          `, [sessionId]);

          await client.query('COMMIT');
          console.log('✅ Sesión actualizada a "completed"\n');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } else if (failedJobs.length > 0) {
        console.log('⚠️  Hay jobs fallidos. Revisar manualmente.\n');
      } else {
        console.log('ℹ️  No hay jobs completados. La sesión puede necesitar un nuevo job.\n');
      }
    } else if (pendingJobs.length > 0) {
      console.log(`✅ Hay ${pendingJobs.length} job(s) pendiente(s) que deberían procesarse automáticamente\n`);
    } else if (runningJobs.length > 0) {
      console.log(`ℹ️  Hay ${runningJobs.length} job(s) corriendo. Esperar a que completen.\n`);
    }

    // Verificar test suites
    const testSuitesResult = await client.query(`
      SELECT 
        ts.id,
        ts.status,
        ts.file_path,
        ts.created_at
      FROM test_suites ts
      WHERE ts.coding_session_id = $1
      ORDER BY ts.created_at DESC
    `, [sessionId]);

    console.log(`📋 Test Suites: ${testSuitesResult.rows.length}\n`);
    
    if (testSuitesResult.rows.length > 0) {
      testSuitesResult.rows.forEach((ts, i) => {
        console.log(`${i + 1}. Test Suite ID: ${ts.id.substring(0, 8)}...`);
        console.log(`   Status: ${ts.status}`);
        console.log(`   File: ${ts.file_path}`);
        console.log(`   Created: ${ts.created_at}`);
        console.log('');
      });
    }

    await client.end();
    console.log('✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixPrismaPendingSession();

