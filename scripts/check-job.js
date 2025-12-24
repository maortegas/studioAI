const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio',
});

const jobId = process.argv[2] || '2abc187b-9a1b-4da4-bce3-c1289b957168';

async function checkJob() {
  try {
    await client.connect();
    console.log('✅ Conectado a la base de datos\n');

    // 1. Verificar el job
    console.log('📊 Información del Job:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const jobResult = await client.query(`
      SELECT 
        id,
        status,
        args->>'phase' as phase,
        args->>'coding_session_id' as session_id,
        args->>'tdd_mode' as tdd_mode,
        args->>'test_strategy' as test_strategy,
        started_at,
        finished_at,
        created_at
      FROM ai_jobs 
      WHERE id = $1
    `, [jobId]);

    if (jobResult.rows.length === 0) {
      console.log('❌ Job no encontrado en ai_jobs');
      console.log('\n🔍 Buscando en coding_sessions...');
      
      // Buscar en coding_sessions
      const sessionResult = await client.query(`
        SELECT 
          id,
          status,
          test_generation_job_id,
          ai_job_id,
          implementation_job_id,
          tdd_cycle,
          updated_at
        FROM coding_sessions
        WHERE test_generation_job_id = $1
           OR ai_job_id = $1
           OR implementation_job_id = $1
      `, [jobId]);
      
      if (sessionResult.rows.length > 0) {
        console.log(`✅ Encontrado en coding_sessions (${sessionResult.rows.length} sesión/es):`);
        sessionResult.rows.forEach((session, index) => {
          console.log(`\n  Sesión ${index + 1}:`);
          console.log(`    ID: ${session.id}`);
          console.log(`    Status: ${session.status}`);
          console.log(`    Test Job ID: ${session.test_generation_job_id || 'N/A'}`);
          console.log(`    AI Job ID: ${session.ai_job_id || 'N/A'}`);
          console.log(`    Impl Job ID: ${session.implementation_job_id || 'N/A'}`);
          console.log(`    Updated: ${session.updated_at}`);
          
          if (session.tdd_cycle) {
            const cycle = session.tdd_cycle;
            console.log(`    TDD Phase: ${cycle.phase || 'N/A'}`);
            console.log(`    Test Index: ${cycle.test_index || 'N/A'}`);
          }
        });
      } else {
        console.log('❌ No se encontró en coding_sessions tampoco');
      }
      
      await client.end();
      return;
    }

    const job = jobResult.rows[0];
    console.log(`ID: ${job.id}`);
    console.log(`Status: ${job.status}`);
    console.log(`Phase: ${job.phase || 'N/A'}`);
    console.log(`Session ID: ${job.session_id || 'N/A'}`);
    console.log(`TDD Mode: ${job.tdd_mode || 'N/A'}`);
    console.log(`Test Strategy: ${job.test_strategy || 'N/A'}`);
    console.log(`Started: ${job.started_at || 'N/A'}`);
    console.log(`Finished: ${job.finished_at || 'N/A'}`);
    console.log(`Created: ${job.created_at || 'N/A'}`);

    // 2. Verificar la sesión relacionada
    if (job.session_id) {
      console.log('\n📊 Información de la Sesión:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const sessionResult = await client.query(`
        SELECT 
          id,
          status,
          tdd_cycle->>'phase' as tdd_phase,
          tdd_cycle->>'test_index' as test_index,
          tdd_cycle->>'total_tests' as total_tests,
          tdd_cycle->>'tests_passed' as tests_passed,
          progress,
          updated_at,
          created_at
        FROM coding_sessions
        WHERE id = $1
      `, [job.session_id]);

      if (sessionResult.rows.length > 0) {
        const session = sessionResult.rows[0];
        console.log(`ID: ${session.id}`);
        console.log(`Status: ${session.status}`);
        console.log(`TDD Phase: ${session.tdd_phase || 'N/A'}`);
        console.log(`Test Index: ${session.test_index || 'N/A'}`);
        console.log(`Total Tests: ${session.total_tests || 'N/A'}`);
        console.log(`Tests Passed: ${session.tests_passed || 'N/A'}`);
        console.log(`Progress: ${session.progress || 0}%`);
        console.log(`Updated: ${session.updated_at}`);
        console.log(`Created: ${session.created_at}`);
      }
    }

    // 3. Verificar eventos recientes
    console.log('\n📊 Eventos Recientes (últimos 10):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const eventsResult = await client.query(`
      SELECT 
        event_type,
        payload,
        timestamp
      FROM ai_job_events
      WHERE job_id = $1
      ORDER BY timestamp DESC
      LIMIT 10
    `, [jobId]);

    if (eventsResult.rows.length === 0) {
      console.log('No hay eventos registrados');
    } else {
      eventsResult.rows.forEach((event, index) => {
        console.log(`\n${index + 1}. ${event.event_type} (${event.timestamp})`);
        if (event.payload) {
          try {
            const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
            console.log(`   Payload: ${JSON.stringify(payload, null, 2)}`);
          } catch (e) {
            console.log(`   Payload: ${event.payload}`);
          }
        }
      });
    }

    // 4. Verificar si hay actualizaciones recientes (posible loop)
    console.log('\n📊 Verificando posibles loops:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Verificar si hay eventos recientes que indiquen actividad
    const recentEvents = await client.query(`
      SELECT 
        COUNT(*) as event_count,
        MIN(timestamp) as first_event,
        MAX(timestamp) as last_event
      FROM ai_job_events
      WHERE job_id = $1
      AND timestamp > NOW() - INTERVAL '5 minutes'
    `, [jobId]);

    console.log(`Eventos en últimos 5 min: ${recentEvents.rows[0].event_count}`);
    if (recentEvents.rows[0].event_count > 0) {
      console.log(`  Primer evento: ${recentEvents.rows[0].first_event}`);
      console.log(`  Último evento: ${recentEvents.rows[0].last_event}`);
    }
    
    // Verificar si hay jobs relacionados que puedan estar causando loops
    if (job.session_id) {
      const relatedJobs = await client.query(`
        SELECT 
          aj.id,
          aj.status,
          aj.args->>'phase' as phase,
          aj.finished_at,
          aj.created_at
        FROM ai_jobs aj
        JOIN coding_sessions cs ON (
          cs.test_generation_job_id = aj.id 
          OR cs.ai_job_id = aj.id 
          OR cs.implementation_job_id = aj.id
        )
        WHERE cs.id = $1
        AND aj.id != $2
        ORDER BY aj.created_at DESC
      `, [job.session_id, jobId]);

      if (relatedJobs.rows.length > 0) {
        console.log(`\nJobs relacionados (${relatedJobs.rows.length}):`);
        relatedJobs.rows.forEach((rj, index) => {
          console.log(`  ${index + 1}. ${rj.id.substring(0, 8)}... - ${rj.status} (${rj.phase}) - Finished: ${rj.finished_at || 'N/A'}`);
        });
      }
    }

    // 5. Verificar si hay procesos activos del worker
    console.log('\n📊 Verificando estado del ciclo TDD:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (job.session_id && job.tdd_mode === 'strict') {
      const tddCycle = await client.query(`
        SELECT 
          tdd_cycle
        FROM coding_sessions
        WHERE id = $1
      `, [job.session_id]);

      if (tddCycle.rows[0]?.tdd_cycle) {
        const cycle = tddCycle.rows[0].tdd_cycle;
        console.log(`Fase actual: ${cycle.phase}`);
        console.log(`Test actual: ${parseInt(cycle.test_index) + 1} de ${cycle.total_tests}`);
        console.log(`Tests pasados: ${cycle.tests_passed}`);
        console.log(`Stuck count: ${cycle.stuck_count || 0}`);
        console.log(`Refactor count: ${cycle.refactor_count || 0}`);
        
        if (cycle.all_tests && cycle.all_tests.length > 0) {
          console.log(`\nTests en el ciclo:`);
          cycle.all_tests.forEach((test, index) => {
            console.log(`  ${index + 1}. ${test.name} - ${test.status} (${test.attempts} intentos)`);
          });
        }
      }
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkJob();

