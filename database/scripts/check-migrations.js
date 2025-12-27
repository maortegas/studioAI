const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_NAME = process.env.DB_NAME || 'devflow_studio';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

async function checkMigrations() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Check if migrations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ Migrations table does not exist. Run migrations first.');
      process.exit(1);
    }

    // Get applied migrations
    const appliedResult = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const applied = appliedResult.rows.map((r) => r.version);

    // Read migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const allMigrations = files.map((f) => f.replace('.sql', ''));

    console.log('\n📋 Migration Status:');
    console.log('='.repeat(60));

    let allApplied = true;
    for (const migration of allMigrations) {
      const isApplied = applied.includes(migration);
      const status = isApplied ? '✅' : '❌';
      console.log(`${status} ${migration}`);
      if (!isApplied) {
        allApplied = false;
      }
    }

    console.log('='.repeat(60));
    console.log(`\nApplied: ${applied.length}/${allMigrations.length}`);

    // Check specific critical migrations
    const criticalMigrations = ['014_add_traceability_foreign_keys'];
    console.log('\n🔍 Checking critical migrations:');
    for (const migration of criticalMigrations) {
      if (applied.includes(migration)) {
        console.log(`✅ ${migration} - Applied`);
        
        // Verify prd_id column exists in tasks table
        if (migration === '014_add_traceability_foreign_keys') {
          const columnCheck = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'tasks' 
              AND column_name = 'prd_id'
            )
          `);
          
          if (columnCheck.rows[0].exists) {
            console.log('   ✅ prd_id column exists in tasks table');
          } else {
            console.log('   ❌ prd_id column MISSING in tasks table');
            console.log('   ⚠️  Migration may have failed. Re-run migration 014.');
            allApplied = false;
          }
        }
      } else {
        console.log(`❌ ${migration} - NOT Applied`);
        allApplied = false;
      }
    }

    if (!allApplied) {
      console.log('\n⚠️  Some migrations are missing. Run: npm run migrate');
      process.exit(1);
    } else {
      console.log('\n✅ All migrations are applied correctly!');
    }
  } catch (error) {
    console.error('❌ Error checking migrations:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

checkMigrations();

