const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio',
});

const sessionId = '2abc187b-9a1b-4da4-bce3-c1289b957168';

async function fixStuckJob() {
  try {
    await client.connect();
    console.log('✅ Conectado a la base de datos\n');

    // Buscar TODOS los jobs en estado 'running' relacionados con esta sesión
    const stuckJobs = await client.query(`
      SELECT 
        aj.id,
        aj.status,
        aj.args->>'phase' as phase,
        aj.started_at,
        EXTRACT(EPOCH FROM (NOW() - aj.started_at))/60 as running_minutes
      FROM ai_jobs aj
      WHERE aj.status = 'running'
      AND aj.args->>'coding_session_id' = $1
      ORDER BY aj.started_at ASC
    `, [sessionId]);

    if (stuckJobs.rows.length === 0) {
      console.log('✅ No hay jobs colgados');
      await client.end();
      return;
    }

    console.log(`📊 Encontrados ${stuckJobs.rows.length} job(s) colgado(s):\n`);

    for (const job of stuckJobs.rows) {
      const runningMinutes = Math.floor(job.running_minutes);
      
      console.log(`Job: ${job.id.substring(0, 8)}...`);
      console.log(`  Phase: ${job.phase}`);
      console.log(`  Running time: ${runningMinutes} minutos`);
      console.log(`  Started: ${job.started_at}`);

      if (runningMinutes > 5) {
        console.log(`  ⚠️  Colgado por más de 5 minutos - marcando como fallido\n`);

        await client.query('BEGIN');

        try {
          // Marcar job como fallido
          await client.query(
            `UPDATE ai_jobs 
             SET status = 'failed', 
                 finished_at = NOW()
             WHERE id = $1`,
            [job.id]
          );

          // Agregar evento
          await client.query(
            `INSERT INTO ai_job_events (job_id, event_type, payload)
             VALUES ($1, 'failed', $2::jsonb)`,
            [job.id, JSON.stringify({ 
              error: `Job timeout: running for more than ${runningMinutes} minutes`,
              timeout: true 
            })]
          );

          // Actualizar sesión si es necesario
          const sessionResult = await client.query(
            `SELECT status, tdd_cycle FROM coding_sessions WHERE id = $1`,
            [sessionId]
          );

          if (sessionResult.rows.length > 0) {
            const session = sessionResult.rows[0];
            const tddCycle = session.tdd_cycle;

            // Si está en una fase TDD y el job colgado es de esa fase, avanzar
            if (tddCycle && job.phase === `tdd_${tddCycle.phase}`) {
              console.log(`  🔄 Avanzando ciclo TDD...`);
              
              // Si está en GREEN y falló, incrementar stuck_count y reintentar o avanzar
              if (tddCycle.phase === 'green') {
                tddCycle.stuck_count = (tddCycle.stuck_count || 0) + 1;
                
                if (tddCycle.stuck_count >= 3) {
                  // Demasiados intentos, avanzar al siguiente test
                  console.log(`  ⚠️  Stuck count >= 3, avanzando al siguiente test`);
                  tddCycle.test_index++;
                  tddCycle.phase = 'red';
                  tddCycle.stuck_count = 0;
                  
                  if (tddCycle.test_index >= tddCycle.total_tests) {
                    // Todos los tests completados
                    await client.query(
                      `UPDATE coding_sessions 
                       SET status = 'completed', 
                           tdd_cycle = $1::jsonb,
                           progress = 100,
                           completed_at = NOW()
                       WHERE id = $2`,
                      [JSON.stringify(tddCycle), sessionId]
                    );
                    console.log(`  ✅ Todos los tests completados`);
                  } else {
                    // Continuar con el siguiente test
                    await client.query(
                      `UPDATE coding_sessions 
                       SET status = 'tdd_red', 
                           tdd_cycle = $1::jsonb
                       WHERE id = $2`,
                      [JSON.stringify(tddCycle), sessionId]
                    );
                    console.log(`  ✅ Avanzado al test ${tddCycle.test_index + 1}`);
                  }
                } else {
                  // Reintentar GREEN
                  await client.query(
                    `UPDATE coding_sessions 
                     SET status = 'tdd_green', 
                         tdd_cycle = $1::jsonb
                     WHERE id = $2`,
                    [JSON.stringify(tddCycle), sessionId]
                  );
                  console.log(`  🔄 Reintentando GREEN (stuck_count: ${tddCycle.stuck_count})`);
                }
              } else {
                // Para otras fases, simplemente marcar error pero no avanzar automáticamente
                await client.query(
                  `UPDATE coding_sessions 
                   SET error = $1
                   WHERE id = $2`,
                  [`Job timeout in ${job.phase} phase`, sessionId]
                );
                console.log(`  ⚠️  Error registrado en sesión`);
              }
            }
          }

          await client.query('COMMIT');
          console.log(`  ✅ Job marcado como fallido y sesión actualizada\n`);

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } else {
        console.log(`  ℹ️  Job reciente (${runningMinutes} min), no se marca como fallido\n`);
      }
    }

    await client.end();
    console.log('✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixStuckJob();

