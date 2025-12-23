const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_NAME = process.env.DB_NAME || 'devflow_studio';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';

const MIGRATION_FILE = process.argv[2];

if (!MIGRATION_FILE) {
  console.error('Usage: node run_single_migration.js <migration_file.sql>');
  process.exit(1);
}

async function runMigration() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    console.log(`Running migration: ${MIGRATION_FILE}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`✓ Applied migration: ${MIGRATION_FILE}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration error:', error.message);
    if (error.detail) {
      console.error('Detail:', error.detail);
    }
    if (error.code) {
      console.error('Error code:', error.code);
    }
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
