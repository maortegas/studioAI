#!/usr/bin/env node

/**
 * Script para re-validar sesiones "completed" que nunca ejecutaron tests
 *
 * Problema: Sesiones marcadas como "completed" sin test executions (bug anterior)
 * Solución: Ejecutar tests realmente y actualizar status basado en resultados
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/devflow_studio'
});

async function executeTestsForProject(projectPath, sessionId) {
  return new Promise((resolve) => {
    console.log(`  [Test] Executing npm test in ${projectPath}...`);

    const childProcess = spawn('npm', ['test'], {
      cwd: projectPath,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    childProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    childProcess.on('close', (code) => {
      // Parse Jest output
      const combinedOutput = output + errorOutput;
      const stats = parseJestOutput(combinedOutput);

      resolve({
        success: code === 0 && stats.failed === 0,
        exitCode: code || 0,
        output: combinedOutput,
        stats
      });
    });

    childProcess.on('error', (error) => {
      resolve({
        success: false,
        exitCode: 1,
        output: errorOutput,
        error: error.message,
        stats: { total: 0, passed: 0, failed: 0, skipped: 0 }
      });
    });
  });
}

function parseJestOutput(output) {
  const stats = { total: 0, passed: 0, failed: 0, skipped: 0 };

  // Pattern: "Tests: 2 failed, 3 passed, 5 total"
  const pattern1 = /Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/;
  const match1 = output.match(pattern1);
  if (match1) {
    stats.failed = parseInt(match1[1]);
    stats.passed = parseInt(match1[2]);
    stats.total = parseInt(match1[3]);
    return stats;
  }

  // Pattern: "Tests: 5 passed, 5 total"
  const pattern2 = /Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/;
  const match2 = output.match(pattern2);
  if (match2) {
    stats.passed = parseInt(match2[1]);
    stats.total = parseInt(match2[2]);
    return stats;
  }

  // Pattern: "Test Suites: 2 failed, 3 passed, 5 total"
  const pattern3 = /Test Suites:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/;
  const match3 = output.match(pattern3);
  if (match3) {
    stats.failed = parseInt(match3[1]);
    stats.passed = parseInt(match3[2]);
    stats.total = parseInt(match3[3]);
  }

  return stats;
}

async function revalidateSessions() {
  try {
    console.log('🔍 Buscando sesiones "completed" sin test executions...\n');

    // Find all "completed" sessions with test_suites but NO test_executions
    const sessionsResult = await pool.query(`
      SELECT
        cs.id as session_id,
        cs.status,
        p.name as project_name,
        p.base_path as project_path,
        COUNT(ts.id) as test_suites_count,
        COUNT(te.id) as executions_count
      FROM coding_sessions cs
      JOIN projects p ON p.id = cs.project_id
      LEFT JOIN test_suites ts ON ts.coding_session_id = cs.id
      LEFT JOIN test_executions te ON te.test_suite_id = ts.id
      WHERE cs.status = 'completed'
      GROUP BY cs.id, cs.status, p.name, p.base_path
      HAVING COUNT(ts.id) > 0 AND COUNT(te.id) = 0
      ORDER BY cs.created_at DESC
    `);

    const sessions = sessionsResult.rows;

    if (sessions.length === 0) {
      console.log('✅ No se encontraron sesiones que necesiten re-validación');
      return;
    }

    console.log(`📋 Encontradas ${sessions.length} sesión(es) que necesitan re-validación:\n`);

    for (const session of sessions) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 Proyecto: ${session.project_name}`);
      console.log(`🆔 Session ID: ${session.session_id}`);
      console.log(`📊 Test Suites: ${session.test_suites_count}, Executions: ${session.executions_count}`);
      console.log(`📁 Path: ${session.project_path}\n`);

      // Execute tests
      const testResult = await executeTestsForProject(session.project_path, session.session_id);

      console.log(`\n📊 Resultados:`);
      console.log(`  Total: ${testResult.stats.total}`);
      console.log(`  Passed: ${testResult.stats.passed}`);
      console.log(`  Failed: ${testResult.stats.failed}`);
      console.log(`  Exit Code: ${testResult.exitCode}`);

      // Update session status based on actual results
      if (testResult.success) {
        console.log(`\n✅ Tests PASSED - Status permanece "completed"`);
        // Session stays "completed" - no update needed
      } else {
        console.log(`\n❌ Tests FAILED - Actualizando status a "failed"`);

        // Extract error summary (first 500 chars)
        const errorSummary = testResult.output.substring(0, 500);

        await pool.query(`
          UPDATE coding_sessions
          SET
            status = 'failed',
            error = $1,
            completed_at = NULL
          WHERE id = $2
        `, [
          `Tests failed during re-validation. ${testResult.stats.failed} of ${testResult.stats.total} tests failed. Error: ${errorSummary}`,
          session.session_id
        ]);

        // Add event
        await pool.query(`
          INSERT INTO coding_session_events (session_id, event_type, payload)
          VALUES ($1, $2, $3)
        `, [
          session.session_id,
          'error',
          JSON.stringify({
            message: 'Session re-validated: tests failed',
            reason: 'Re-validation script found session marked as completed without test executions',
            test_results: testResult.stats
          })
        ]);

        console.log(`  💾 Status actualizado en base de datos`);
      }

      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n✅ Re-validación completada para ${sessions.length} sesión(es)`);

  } catch (error) {
    console.error('❌ Error durante re-validación:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run
console.log('═══════════════════════════════════════════════════════');
console.log('   RE-VALIDACIÓN DE SESIONES COMPLETADAS SIN TESTS');
console.log('═══════════════════════════════════════════════════════\n');

revalidateSessions()
  .then(() => {
    console.log('\n✅ Proceso completado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Proceso falló:', error);
    process.exit(1);
  });
