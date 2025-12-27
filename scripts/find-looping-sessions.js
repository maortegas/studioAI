const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio',
});

async function findLoopingSessions() {
  try {
    await client.connect();
    console.log('✅ Conectado a la base de datos\n');

    // Buscar sesiones que se actualizaron recientemente y frecuentemente
    console.log('📊 Buscando sesiones con actividad reciente (últimos 5 minutos):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const recentSessions = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.tdd_cycle->>'phase' as tdd_phase,
        cs.tdd_cycle->>'test_index' as test_index,
        cs.tdd_cycle->>'stuck_count' as stuck_count,
        cs.updated_at,
        COUNT(aj.id) as related_jobs_count
      FROM coding_sessions cs
      LEFT JOIN ai_jobs aj ON (
        cs.test_generation_job_id = aj.id 
        OR cs.ai_job_id = aj.id 
        OR cs.implementation_job_id = aj.id
      )
      WHERE cs.updated_at > NOW() - INTERVAL '5 minutes'
      GROUP BY cs.id, cs.status, cs.tdd_cycle, cs.updated_at
      ORDER BY cs.updated_at DESC
      LIMIT 20
    `);

    if (recentSessions.rows.length === 0) {
      console.log('No hay sesiones con actividad reciente');
    } else {
      recentSessions.rows.forEach((session, index) => {
        console.log(`\n${index + 1}. Sesión: ${session.id.substring(0, 8)}...`);
        console.log(`   Status: ${session.status}`);
        console.log(`   TDD Phase: ${session.tdd_phase || 'N/A'}`);
        console.log(`   Test Index: ${session.test_index || 'N/A'}`);
        console.log(`   Stuck Count: ${session.stuck_count || 0}`);
        console.log(`   Jobs relacionados: ${session.related_jobs_count}`);
        console.log(`   Última actualización: ${session.updated_at}`);
      });
    }

    // Buscar sesiones en estados TDD que puedan estar en loop
    console.log('\n\n📊 Sesiones en estados TDD:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const tddSessions = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.tdd_cycle->>'phase' as tdd_phase,
        cs.tdd_cycle->>'test_index' as test_index,
        cs.tdd_cycle->>'total_tests' as total_tests,
        cs.tdd_cycle->>'stuck_count' as stuck_count,
        cs.tdd_cycle->>'refactor_count' as refactor_count,
        cs.updated_at,
        cs.created_at
      FROM coding_sessions cs
      WHERE cs.status IN ('tdd_red', 'tdd_green', 'tdd_refactor')
      ORDER BY cs.updated_at DESC
      LIMIT 10
    `);

    if (tddSessions.rows.length === 0) {
      console.log('No hay sesiones en estados TDD');
    } else {
      tddSessions.rows.forEach((session, index) => {
        console.log(`\n${index + 1}. Sesión: ${session.id.substring(0, 8)}...`);
        console.log(`   Status: ${session.status}`);
        console.log(`   TDD Phase: ${session.tdd_phase || 'N/A'}`);
        console.log(`   Test: ${parseInt(session.test_index || 0) + 1} de ${session.total_tests || 'N/A'}`);
        console.log(`   Stuck Count: ${session.stuck_count || 0} ${parseInt(session.stuck_count || 0) >= 3 ? '⚠️ ALTO' : ''}`);
        console.log(`   Refactor Count: ${session.refactor_count || 0}`);
        console.log(`   Creada: ${session.created_at}`);
        console.log(`   Actualizada: ${session.updated_at}`);
        
        // Verificar si está actualizándose frecuentemente
        const timeDiff = new Date() - new Date(session.updated_at);
        if (timeDiff < 60000) { // Menos de 1 minuto
          console.log(`   ⚠️  ACTUALIZADA HACE MENOS DE 1 MINUTO - POSIBLE LOOP`);
        }
      });
    }

    // Buscar jobs que están en 'running' por mucho tiempo
    console.log('\n\n📊 Jobs en estado "running" por más de 10 minutos:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const longRunningJobs = await client.query(`
      SELECT 
        aj.id,
        aj.status,
        aj.args->>'phase' as phase,
        aj.args->>'coding_session_id' as session_id,
        aj.started_at,
        NOW() - aj.started_at as running_time
      FROM ai_jobs aj
      WHERE aj.status = 'running'
      AND aj.started_at < NOW() - INTERVAL '10 minutes'
      ORDER BY aj.started_at ASC
      LIMIT 10
    `);

    if (longRunningJobs.rows.length === 0) {
      console.log('No hay jobs corriendo por mucho tiempo');
    } else {
      longRunningJobs.rows.forEach((job, index) => {
        console.log(`\n${index + 1}. Job: ${job.id.substring(0, 8)}...`);
        console.log(`   Phase: ${job.phase || 'N/A'}`);
        console.log(`   Session: ${job.session_id ? job.session_id.substring(0, 8) + '...' : 'N/A'}`);
        console.log(`   Started: ${job.started_at}`);
        console.log(`   Running time: ${job.running_time}`);
        console.log(`   ⚠️  POSIBLE LOOP O JOB COLGADO`);
      });
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

findLoopingSessions();

