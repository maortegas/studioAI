/**
 * AgentDB Service Wrapper
 * 
 * This service provides a wrapper around AgentDB SDK for managing
 * persistent context databases for coding sessions.
 * 
 * Note: Requires agentdb package to be installed
 * Install with: npm install agentdb
 * 
 * Version: AgentDB v1.3.9+
 * Documentation: https://github.com/ruvnet/agentic-flow/tree/main/packages/agentdb
 * Package: https://www.npmjs.com/package/agentdb
 * 
 * AgentDB is a local SQLite database, not a cloud service.
 * No API keys or URLs are required.
 */

import * as path from 'path';
import * as fs from 'fs/promises';

// Dynamic import to handle case where package is not installed
let AgentDBClass: any = null;

async function getAgentDBClass() {
  if (!AgentDBClass) {
    try {
      console.log('[AgentDBService] Importing agentdb module...');
      const agentdbModule = await import('agentdb');
      console.log('[AgentDBService] ✅ Successfully imported agentdb module');
      console.log('[AgentDBService] Module exports:', Object.keys(agentdbModule));
      
      // AgentDB uses createDatabase function, not a class
      // We'll create a wrapper that mimics the AgentDB class interface
      AgentDBClass = agentdbModule.createDatabase;
      
      if (!AgentDBClass) {
        console.error('[AgentDBService] ❌ createDatabase function not found in agentdb package');
        console.error('[AgentDBService] Available exports:', Object.keys(agentdbModule));
        throw new Error('createDatabase function not found in agentdb package');
      }
      
      console.log('[AgentDBService] ✅ createDatabase function found');
    } catch (error: any) {
      console.error('[AgentDBService] ❌ Failed to import agentdb:', error.message);
      console.error('[AgentDBService] Error stack:', error.stack);
      console.error('[AgentDBService] Please install with: npm install agentdb');
      throw new Error('AgentDB SDK not available. Please install agentdb package.');
    }
  }
  return AgentDBClass;
}

export interface AgentDBInstance {
  db: any; // SQLite database instance
  initialize(): Promise<void>;
  close(): void;
}

export class AgentDBService {
  private instances: Map<string, AgentDBInstance> = new Map();

  /**
   * Get or create an AgentDB instance for a project
   * All sessions for the same project share one database file
   * Creates a new database file if it doesn't exist
   */
  async getInstance(projectPath: string, sessionId: string): Promise<AgentDBInstance> {
    // Use project path as cache key - one DB per project, not per session
    const cacheKey = projectPath;
    
    if (this.instances.has(cacheKey)) {
      console.log(`[AgentDBService] Using cached database instance for project`);
      return this.instances.get(cacheKey)!;
    }

    console.log(`[AgentDBService] Creating new database instance`);
    console.log(`[AgentDBService] Project path: ${projectPath}`);
    console.log(`[AgentDBService] Session ID: ${sessionId}`);

    const createDatabase = await getAgentDBClass();
    
    // Extract project name from path (last segment)
    const projectName = path.basename(projectPath);
    console.log(`[AgentDBService] Project name: ${projectName}`);
    
    // Create database path: {projectPath}/.agentdb/{projectName}.db
    // One database per project, all sessions stored in same DB with session_id key
    const dbDir = path.join(projectPath, '.agentdb');
    console.log(`[AgentDBService] Database directory: ${dbDir}`);
    
    try {
      await fs.mkdir(dbDir, { recursive: true });
      console.log(`[AgentDBService] ✅ Created/verified directory: ${dbDir}`);
    } catch (error: any) {
      console.error(`[AgentDBService] ❌ Error creating directory:`, error.message);
      throw error;
    }
    
    const dbPath = path.join(dbDir, `${projectName}.db`);
    console.log(`[AgentDBService] Database file path: ${dbPath}`);

    // Check if file already exists
    try {
      const existingStats = await fs.stat(dbPath);
      console.log(`[AgentDBService] ⚠️ Database file already exists: ${dbPath} (${existingStats.size} bytes)`);
    } catch {
      console.log(`[AgentDBService] Database file does not exist yet (will be created)`);
    }

    try {
      // Create database instance using createDatabase function
      // createDatabase returns a SQLite database instance directly
      console.log(`[AgentDBService] Calling createDatabase(${dbPath})...`);
      const sqliteDb = await createDatabase(dbPath);
      console.log(`[AgentDBService] ✅ Database instance created successfully`);
      
      // Wrap in an object that matches AgentDBInstance interface
      // The db property should be the SQLite database instance
      const dbWrapper = {
        db: sqliteDb,
        initialize: async () => {}, // Already initialized
        close: () => {
          // sql.js requires explicit save() to persist to disk
          if (typeof sqliteDb.save === 'function') {
            try {
              sqliteDb.save();
              console.log(`[AgentDBService] ✅ Database saved to ${dbPath}`);
            } catch (saveError: any) {
              console.error(`[AgentDBService] Error saving database:`, saveError);
            }
          }
          
          if (typeof sqliteDb.close === 'function') {
            sqliteDb.close();
          }
        }
      };

      // Initialize schema for TDD context
      console.log(`[AgentDBService] Initializing database schema...`);
      await this.initializeSchema(dbWrapper);
      console.log(`[AgentDBService] ✅ Schema initialized successfully`);
      
      // Force a write operation to ensure file is created
      // sql.js requires explicit save() after writes to persist to disk
      try {
        console.log(`[AgentDBService] Forcing file creation with test write...`);
        
        const testStmt = sqliteDb.prepare('INSERT OR IGNORE INTO tests (session_id, name, code, status) VALUES (?, ?, ?, ?)');
        testStmt.run('__init__', '__init__', '--', 'pending');
        
        // sql.js requires explicit save() to persist changes to disk
        if (typeof sqliteDb.save === 'function') {
          try {
            sqliteDb.save();
            console.log(`[AgentDBService] ✅ Database saved to disk: ${dbPath}`);
          } catch (saveError: any) {
            console.error(`[AgentDBService] Error saving after test write:`, saveError);
          }
        }
        
        console.log(`[AgentDBService] ✅ Test write completed`);
      } catch (writeError: any) {
        console.warn(`[AgentDBService] ⚠️ Test write failed:`, writeError.message);
      }
      
      // Check if file exists after write operation
      // SQLite creates the file on first write, so check after forcing a write
      try {
        const stats = await fs.stat(dbPath);
        console.log(`[AgentDBService] ✅ Database file exists: ${dbPath} (${stats.size} bytes)`);
      } catch (statError: any) {
        if (statError.code === 'ENOENT') {
          console.warn(`[AgentDBService] ⚠️ Database file still not found after write: ${dbPath}`);
          console.warn(`[AgentDBService] This may indicate in-memory mode or a different storage mechanism`);
          console.warn(`[AgentDBService] Checking if agentdb uses a different file path...`);
          
          // Check if there are any .db files in the directory
          try {
            const files = await fs.readdir(dbDir);
            const dbFiles = files.filter(f => f.endsWith('.db'));
            if (dbFiles.length > 0) {
              console.log(`[AgentDBService] Found ${dbFiles.length} .db file(s) in directory:`, dbFiles);
            } else {
              console.warn(`[AgentDBService] No .db files found in directory: ${dbDir}`);
            }
          } catch (readError) {
            console.error(`[AgentDBService] Error reading directory:`, readError);
          }
        } else {
          console.error(`[AgentDBService] Error checking file existence:`, statError.message);
        }
      }

      const instance: AgentDBInstance = {
        db: dbWrapper.db,
        initialize: async () => {}, // Already initialized
        close: () => {
          dbWrapper.close();
          this.instances.delete(cacheKey);
          console.log(`[AgentDBService] Closed database instance for project ${projectName}`);
        }
      };

      this.instances.set(cacheKey, instance);
      console.log(`[AgentDBService] ✅ Database instance cached and ready (shared by all sessions)`);
      return instance;
    } catch (error: any) {
      console.error(`[AgentDBService] ❌ Error creating database:`, error);
      console.error(`[AgentDBService] Error message:`, error.message);
      console.error(`[AgentDBService] Error stack:`, error.stack);
      throw error;
    }
  }

  /**
   * Initialize database schema for TDD context
   * Uses direct SQLite access through db.db.exec()
   */
  private async initializeSchema(db: any): Promise<void> {
    // Access SQLite database directly
    const sqliteDb = db.db;

    try {
      // Create tests table
      console.log(`[AgentDBService] Creating 'tests' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS tests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          story_id TEXT,
          name TEXT NOT NULL,
          code TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create code table
      console.log(`[AgentDBService] Creating 'code' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS code (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          story_id TEXT,
          file_path TEXT NOT NULL,
          content TEXT NOT NULL,
          tests_passing INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create decisions table
      console.log(`[AgentDBService] Creating 'decisions' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          story_id TEXT,
          action TEXT NOT NULL,
          reason TEXT,
          code_snippet TEXT,
          test_related TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create history table
      console.log(`[AgentDBService] Creating 'history' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          action TEXT NOT NULL,
          result TEXT,
          files_modified TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create traceability table
      console.log(`[AgentDBService] Creating 'traceability' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS traceability (
          session_id TEXT PRIMARY KEY,
          prd_id TEXT,
          story_id TEXT NOT NULL,
          design_id TEXT,
          rfc_id TEXT,
          epic_id TEXT,
          breakdown_tasks TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create tdd_state table
      console.log(`[AgentDBService] Creating 'tdd_state' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS tdd_state (
          session_id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create tdd_rules table
      console.log(`[AgentDBService] Creating 'tdd_rules' table...`);
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS tdd_rules (
          session_id TEXT PRIMARY KEY,
          rules_json TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes for better performance
      console.log(`[AgentDBService] Creating indexes...`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_tests_session_id ON tests(session_id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_code_session_id ON code(session_id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_decisions_session_id ON decisions(session_id);`);
      sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_history_session_id ON history(session_id);`);
      
      console.log(`[AgentDBService] ✅ All tables and indexes created successfully`);
    } catch (error: any) {
      console.error(`[AgentDBService] ❌ Error initializing schema:`, error.message);
      console.error(`[AgentDBService] Error stack:`, error.stack);
      throw error;
    }
  }

  /**
   * Execute SQL query with parameters (SELECT)
   * Helper method to execute prepared statements
   */
  async executeQuery(
    db: any,
    sql: string,
    params: any[] = []
  ): Promise<any[]> {
    const sqliteDb = db.db;
    
    // Use prepared statement for parameterized queries
    // SQLite pattern: prepare().all() for SELECT queries
    try {
      const stmt = sqliteDb.prepare(sql);
      const result = stmt.all(...params);
      return Array.isArray(result) ? result : [];
    } catch (error: any) {
      console.error('[AgentDBService] Error executing query:', error.message);
      console.error('[AgentDBService] SQL:', sql);
      console.error('[AgentDBService] Params:', params);
      throw error;
    }
  }

  /**
   * Execute SQL statement (INSERT, UPDATE, DELETE)
   * Helper method for write operations
   */
  async executeStatement(
    db: any,
    sql: string,
    params: any[] = []
  ): Promise<void> {
    const sqliteDb = db.db;
    
    // Use prepared statement for parameterized queries
    // SQLite pattern: prepare().run() for INSERT/UPDATE/DELETE
    try {
      const stmt = sqliteDb.prepare(sql);
      stmt.run(...params);
      
      // sql.js needs save() after each write to persist to disk
      if (typeof sqliteDb.save === 'function') {
        try {
          sqliteDb.save();
        } catch (saveError: any) {
          console.error('[AgentDBService] Error saving after statement:', saveError);
        }
      }
    } catch (error: any) {
      console.error('[AgentDBService] Error executing statement:', error.message);
      console.error('[AgentDBService] SQL:', sql);
      console.error('[AgentDBService] Params:', params);
      throw error;
    }
  }

  /**
   * Check if AgentDB is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await getAgentDBClass();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close all instances
   */
  closeAll(): void {
    for (const instance of this.instances.values()) {
      instance.close();
    }
    this.instances.clear();
  }
}
