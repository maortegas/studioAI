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

    // Buscar jobs running
    const jobs = await client.query(`
      SELECT 
        aj.id,
        aj.status,
        aj.args->>'phase' as phase,
        aj.started_at,
        EXTRACT(EPOCH FROM (NOW() - aj.started_at))/60 as running_minutes
      FROM ai_jobs aj
      WHERE aj.status = 'running'
      AND aj.args->>'coding_session_id' = $1
    `, [sessionId]);

    if (jobs.rows.length === 0) {
      console.log('✅ No hay jobs colgados');
      await client.end();
      return;
    }

    console.log(`📊 Encontrados ${jobs.rows.length} job(s) colgado(s):\n`);

    for (const job of jobs.rows) {
      const minutes = Math.floor(job.running_minutes);
      const hours = Math.floor(minutes / 60);
      
      console.log(`Job: ${job.id.substring(0, 8)}...`);
      console.log(`  Phase: ${job.phase}`);
      console.log(`  Started: ${job.started_at}`);
      console.log(`  Running: ${hours}h ${minutes % 60}m (${minutes} minutos)`);

      if (minutes > 5) {
        console.log(`  ⚠️  COLGADO - marcando como fallido\n`);

        await client.query('BEGIN');
        try {
          // Marcar job como fallido
          await client.query(
            `UPDATE ai_jobs SET status = 'failed', finished_at = NOW() WHERE id = $1`,
            [job.id]
          );

          // Agregar evento
          await client.query(
            `INSERT INTO ai_job_events (job_id, event_type, payload)
             VALUES ($1, 'failed', $2::jsonb)`,
            [job.id, JSON.stringify({ 
              error: `Job timeout: running for more than ${minutes} minutes`,
              timeout: true 
            })]
          );

          // Actualizar sesión
          const session = await client.query(
            'SELECT tdd_cycle FROM coding_sessions WHERE id = $1',
            [sessionId]
          );

          if (session.rows[0]?.tdd_cycle) {
            const cycle = session.rows[0].tdd_cycle;

            // Si está en refactor y falló, avanzar al siguiente test
            if (job.phase === 'tdd_refactor' && cycle.phase === 'refactor') {
              cycle.test_index++;
              cycle.phase = 'red';
              cycle.stuck_count = 0;

              if (cycle.test_index >= cycle.total_tests) {
                await client.query(
                  `UPDATE coding_sessions 
                   SET status = 'completed', 
                       tdd_cycle = $1::jsonb, 
                       progress = 100, 
                       completed_at = NOW() 
                   WHERE id = $2`,
                  [JSON.stringify(cycle), sessionId]
                );
                console.log(`  ✅ Todos los tests completados`);
              } else {
                await client.query(
                  `UPDATE coding_sessions 
                   SET status = 'tdd_red', 
                       tdd_cycle = $1::jsonb 
                   WHERE id = $2`,
                  [JSON.stringify(cycle), sessionId]
                );
                console.log(`  ✅ Avanzado al test ${cycle.test_index + 1}`);
              }
            } else if (job.phase === 'tdd_green' && cycle.phase === 'green') {
              // Si está en GREEN y falló, incrementar stuck_count
              cycle.stuck_count = (cycle.stuck_count || 0) + 1;

              if (cycle.stuck_count >= 3) {
                // Demasiados intentos, avanzar al siguiente test
                cycle.test_index++;
                cycle.phase = 'red';
                cycle.stuck_count = 0;

                if (cycle.test_index >= cycle.total_tests) {
                  await client.query(
                    `UPDATE coding_sessions 
                     SET status = 'completed', 
                         tdd_cycle = $1::jsonb, 
                         progress = 100, 
                         completed_at = NOW() 
                     WHERE id = $2`,
                    [JSON.stringify(cycle), sessionId]
                  );
                  console.log(`  ✅ Todos los tests completados`);
                } else {
                  await client.query(
                    `UPDATE coding_sessions 
                     SET status = 'tdd_red', 
                         tdd_cycle = $1::jsonb 
                     WHERE id = $2`,
                    [JSON.stringify(cycle), sessionId]
                  );
                  console.log(`  ✅ Avanzado al test ${cycle.test_index + 1} (stuck_count >= 3)`);
                }
              } else {
                // Reintentar GREEN
                await client.query(
                  `UPDATE coding_sessions 
                   SET status = 'tdd_green', 
                       tdd_cycle = $1::jsonb 
                   WHERE id = $2`,
                  [JSON.stringify(cycle), sessionId]
                );
                console.log(`  🔄 Reintentando GREEN (stuck_count: ${cycle.stuck_count})`);
              }
            } else {
              // Para otras fases, solo registrar error
              await client.query(
                `UPDATE coding_sessions 
                 SET error = $1 
                 WHERE id = $2`,
                [`Job timeout in ${job.phase} phase after ${minutes} minutes`, sessionId]
              );
              console.log(`  ⚠️  Error registrado en sesión`);
            }
          }

          await client.query('COMMIT');
          console.log(`  ✅ Job marcado como fallido y sesión actualizada\n`);

        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } else {
        console.log(`  ℹ️  Job reciente (${minutes} min), no se marca como fallido\n`);
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

