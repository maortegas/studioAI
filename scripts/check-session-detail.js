const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio',
});

const sessionId = process.argv[2] || '2abc187b-9a1b-4da4-bce3-c1289b957168';

async function checkSession() {
  try {
    await client.connect();
    console.log('✅ Conectado a la base de datos\n');

    // Obtener sesión completa
    const sessionResult = await client.query(`
      SELECT 
        cs.*,
        cs.tdd_cycle
      FROM coding_sessions cs
      WHERE cs.id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      console.log('❌ Sesión no encontrada');
      await client.end();
      return;
    }

    const session = sessionResult.rows[0];
    console.log('📊 Información de la Sesión:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`ID: ${session.id}`);
    console.log(`Status: ${session.status}`);
    console.log(`Progress: ${session.progress}%`);
    console.log(`Updated: ${session.updated_at}`);
    console.log(`Created: ${session.created_at}`);

    if (session.tdd_cycle) {
      const cycle = session.tdd_cycle;
      console.log(`\n📊 TDD Cycle:`);
      console.log(`   Phase: ${cycle.phase}`);
      console.log(`   Test Index: ${cycle.test_index} (Test ${parseInt(cycle.test_index) + 1} de ${cycle.total_tests})`);
      console.log(`   Tests Passed: ${cycle.tests_passed}`);
      console.log(`   Total Tests: ${cycle.total_tests}`);
      console.log(`   Stuck Count: ${cycle.stuck_count || 0}`);
      console.log(`   Refactor Count: ${cycle.refactor_count || 0}`);
      
      if (cycle.all_tests && cycle.all_tests.length > 0) {
        console.log(`\n   Tests en el ciclo:`);
        cycle.all_tests.slice(0, 10).forEach((test, index) => {
          console.log(`     ${index + 1}. ${test.name} - ${test.status} (${test.attempts} intentos)`);
        });
        if (cycle.all_tests.length > 10) {
          console.log(`     ... y ${cycle.all_tests.length - 10} más`);
        }
      }
    }

    // Verificar jobs relacionados
    console.log(`\n📊 Jobs Relacionados:`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const jobsResult = await client.query(`
      SELECT 
        aj.id,
        aj.status,
        aj.args->>'phase' as phase,
        aj.args->>'tdd_mode' as tdd_mode,
        aj.started_at,
        aj.finished_at,
        aj.created_at
      FROM ai_jobs aj
      WHERE aj.id = $1
         OR aj.id = $2
         OR aj.id = $3
      ORDER BY aj.created_at DESC
    `, [session.test_generation_job_id, session.ai_job_id, session.implementation_job_id]);

    if (jobsResult.rows.length === 0) {
      console.log('No hay jobs relacionados');
    } else {
      jobsResult.rows.forEach((job, index) => {
        console.log(`\n${index + 1}. Job: ${job.id.substring(0, 8)}...`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Phase: ${job.phase || 'N/A'}`);
        console.log(`   TDD Mode: ${job.tdd_mode || 'N/A'}`);
        console.log(`   Started: ${job.started_at || 'N/A'}`);
        console.log(`   Finished: ${job.finished_at || 'N/A'}`);
        console.log(`   Created: ${job.created_at}`);
      });
    }

    // Verificar eventos recientes de la sesión
    console.log(`\n📊 Eventos Recientes (últimos 20):`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const eventsResult = await client.query(`
      SELECT 
        event_type,
        payload,
        created_at
      FROM coding_session_events
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [sessionId]);

    if (eventsResult.rows.length === 0) {
      console.log('No hay eventos registrados');
    } else {
      eventsResult.rows.forEach((event, index) => {
        const timeAgo = new Date() - new Date(event.created_at);
        const minutesAgo = Math.floor(timeAgo / 60000);
        console.log(`\n${index + 1}. ${event.event_type} (hace ${minutesAgo} min)`);
        if (event.payload) {
          try {
            const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
            if (payload.progress !== undefined) {
              console.log(`   Progress: ${payload.progress}%`);
            }
            if (payload.test_progress !== undefined) {
              console.log(`   Test Progress: ${payload.test_progress}%`);
            }
            if (payload.implementation_progress !== undefined) {
              console.log(`   Impl Progress: ${payload.implementation_progress}%`);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      });
    }

    // Verificar si hay actualizaciones repetidas (posible loop)
    console.log(`\n📊 Verificando posibles loops:`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const updateHistory = await client.query(`
      SELECT 
        COUNT(*) as update_count,
        MIN(updated_at) as first_update,
        MAX(updated_at) as last_update
      FROM coding_sessions
      WHERE id = $1
      AND updated_at > NOW() - INTERVAL '10 minutes'
    `, [sessionId]);

    console.log(`Actualizaciones en últimos 10 min: ${updateHistory.rows[0].update_count}`);
    
    // Verificar eventos repetidos
    const recentEvents = await client.query(`
      SELECT 
        event_type,
        COUNT(*) as count
      FROM coding_session_events
      WHERE session_id = $1
      AND created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY event_type
      ORDER BY count DESC
    `, [sessionId]);

    if (recentEvents.rows.length > 0) {
      console.log(`\nEventos en últimos 10 min:`);
      recentEvents.rows.forEach((row) => {
        console.log(`  ${row.event_type}: ${row.count} veces`);
        if (parseInt(row.count) > 10) {
          console.log(`    ⚠️  MUCHOS EVENTOS - POSIBLE LOOP`);
        }
      });
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkSession();

