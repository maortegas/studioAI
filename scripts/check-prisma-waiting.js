const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio'
});

async function checkPrismaWaiting() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Buscar proyectos con nombre "d"
    const projectsResult = await client.query(`
      SELECT id, name, base_path
      FROM projects
      WHERE name = 'd' OR base_path LIKE '%/d%'
      ORDER BY created_at DESC
    `);

    if (projectsResult.rows.length === 0) {
      console.log('❌ No se encontró proyecto "d"\n');
      await client.end();
      return;
    }

    const project = projectsResult.rows[0];
    console.log(`📁 Proyecto encontrado: ${project.name} (${project.id})\n`);

    // Buscar tareas relacionadas con Prisma
    const tasksResult = await client.query(`
      SELECT 
        t.id,
        t.title,
        t.status,
        t.project_id
      FROM tasks t
      WHERE t.project_id = $1
        AND (t.title ILIKE '%prisma%' 
             OR t.title ILIKE '%postgresql%'
             OR t.title ILIKE '%configurar%orm%'
             OR t.title ILIKE '%conexión%postgres%')
      ORDER BY t.created_at DESC
    `, [project.id]);

    console.log(`📋 Tareas relacionadas con Prisma/PostgreSQL: ${tasksResult.rows.length}\n`);
    
    if (tasksResult.rows.length > 0) {
      tasksResult.rows.forEach((task, i) => {
        console.log(`${i + 1}. Task ID: ${task.id}`);
        console.log(`   Title: ${task.title}`);
        console.log(`   Status: ${task.status}`);
        console.log('');
      });
    }

    // Buscar sesiones de coding relacionadas
    const sessionsResult = await client.query(`
      SELECT 
        cs.id,
        cs.status,
        cs.progress,
        cs.ai_job_id,
        cs.started_at,
        cs.completed_at,
        cs.created_at,
        cs.error,
        t.title as task_title
      FROM coding_sessions cs
      JOIN tasks t ON t.id = cs.story_id
      WHERE cs.project_id = $1
        AND (t.title ILIKE '%prisma%' 
             OR t.title ILIKE '%postgresql%'
             OR t.title ILIKE '%configurar%orm%'
             OR t.title ILIKE '%conexión%postgres%')
      ORDER BY cs.created_at DESC
      LIMIT 10
    `, [project.id]);

    console.log(`📋 Coding Sessions relacionadas: ${sessionsResult.rows.length}\n`);
    
    if (sessionsResult.rows.length > 0) {
      sessionsResult.rows.forEach((session, i) => {
        console.log(`${i + 1}. Session ID: ${session.id}`);
        console.log(`   Task: ${session.task_title}`);
        console.log(`   Status: ${session.status}`);
        console.log(`   Progress: ${session.progress}%`);
        console.log(`   AI Job ID: ${session.ai_job_id || 'N/A'}`);
        console.log(`   Started: ${session.started_at || 'Not started'}`);
        console.log(`   Completed: ${session.completed_at || 'Not completed'}`);
        console.log(`   Error: ${session.error || 'None'}`);
        console.log(`   Created: ${session.created_at}`);
        console.log('');
      });
    }

    // Buscar jobs en estado pending/waiting relacionados
    const jobsResult = await client.query(`
      SELECT 
        aj.id,
        aj.status,
        aj.provider,
        aj.command,
        aj.started_at,
        aj.finished_at,
        aj.created_at,
        aj.args->>'phase' as phase,
        aj.args->>'coding_session_id' as coding_session_id,
        t.title as task_title
      FROM ai_jobs aj
      LEFT JOIN coding_sessions cs ON aj.args->>'coding_session_id' = cs.id::text
      LEFT JOIN tasks t ON cs.story_id = t.id
      WHERE aj.project_id = $1
        AND aj.status IN ('pending', 'waiting')
        AND (t.title ILIKE '%prisma%' 
             OR t.title ILIKE '%postgresql%'
             OR t.title ILIKE '%configurar%orm%'
             OR t.title ILIKE '%conexión%postgres%'
             OR aj.command ILIKE '%prisma%'
             OR aj.command ILIKE '%postgres%')
      ORDER BY aj.created_at DESC
      LIMIT 10
    `, [project.id]);

    console.log(`📋 Jobs en estado pending/waiting: ${jobsResult.rows.length}\n`);
    
    if (jobsResult.rows.length > 0) {
      jobsResult.rows.forEach((job, i) => {
        console.log(`${i + 1}. Job ID: ${job.id}`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Provider: ${job.provider}`);
        console.log(`   Command: ${job.command}`);
        console.log(`   Phase: ${job.phase || 'N/A'}`);
        console.log(`   Task: ${job.task_title || 'N/A'}`);
        console.log(`   Coding Session ID: ${job.coding_session_id || 'N/A'}`);
        console.log(`   Started: ${job.started_at || 'Not started'}`);
        console.log(`   Created: ${job.created_at}`);
        console.log('');
      });
    } else {
      console.log('   No hay jobs en estado pending/waiting\n');
    }

    // Buscar también en breakdown_tasks (si existe)
    try {
      const breakdownResult = await client.query(`
        SELECT 
          bt.id,
          bt.title,
          bt.status,
          bt.task_id,
          t.title as parent_task_title
        FROM breakdown_tasks bt
        JOIN tasks t ON t.id = bt.task_id
        WHERE t.project_id = $1
          AND (bt.title ILIKE '%prisma%' 
               OR bt.title ILIKE '%postgresql%'
               OR bt.title ILIKE '%configurar%orm%'
               OR bt.title ILIKE '%conexión%postgres%')
        ORDER BY bt.created_at DESC
        LIMIT 10
      `, [project.id]);

      console.log(`📋 Breakdown Tasks relacionadas: ${breakdownResult.rows.length}\n`);
      
      if (breakdownResult.rows.length > 0) {
        breakdownResult.rows.forEach((bt, i) => {
          console.log(`${i + 1}. Breakdown Task ID: ${bt.id}`);
          console.log(`   Title: ${bt.title}`);
          console.log(`   Status: ${bt.status}`);
          console.log(`   Parent Task: ${bt.parent_task_title}`);
          console.log('');
        });
      }
    } catch (error) {
      // Tabla breakdown_tasks no existe, continuar
      console.log('   (breakdown_tasks table not found, skipping)\n');
    }

    await client.end();
    console.log('✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkPrismaWaiting();

