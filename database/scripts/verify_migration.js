const { Client } = require('pg');

const DB_NAME = process.env.DB_NAME || 'devflow_studio';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

async function verifyMigration() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const tablesToCheck = [
      'prd_documents',
      'user_flows',
      'prototypes',
      'rfc_documents',
      'api_contracts',
      'database_schemas',
      'epics'
    ];

    console.log('Checking new tables:\n');
    for (const tableName of tablesToCheck) {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )`,
        [tableName]
      );
      
      if (result.rows[0].exists) {
        // Get column count
        const colResult = await client.query(
          `SELECT COUNT(*) as count 
           FROM information_schema.columns 
           WHERE table_name = $1`,
          [tableName]
        );
        console.log(`✅ ${tableName} - exists (${colResult.rows[0].count} columns)`);
      } else {
        console.log(`❌ ${tableName} - NOT FOUND`);
      }
    }

    // Check if tasks table has new columns
    console.log('\nChecking extended tasks table columns:\n');
    const tasksCols = [
      'acceptance_criteria',
      'generated_from_prd',
      'story_points',
      'epic_id',
      'estimated_days',
      'breakdown_order'
    ];

    for (const colName of tasksCols) {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'tasks' 
          AND column_name = $1
        )`,
        [colName]
      );
      
      if (result.rows[0].exists) {
        console.log(`✅ tasks.${colName} - exists`);
      } else {
        console.log(`❌ tasks.${colName} - NOT FOUND`);
      }
    }

    console.log('\n✅ Migration verification complete!');
  } catch (error) {
    console.error('❌ Verification error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyMigration();
