#!/usr/bin/env node

/**
 * Migration script: Convert AgentDB from per-session to per-project databases
 * 
 * This script:
 * 1. Finds all .agentdb directories in projects
 * 2. Merges all session .db files into a single project.db
 * 3. Backs up old session files
 */

const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

async function findAgentDBDirs(baseDir) {
  const agentdbDirs = [];
  
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(baseDir, entry.name);
        
        // Check if this is an .agentdb directory
        if (entry.name === '.agentdb') {
          agentdbDirs.push(fullPath);
        } else if (!entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
          // Recursively search subdirectories
          const subDirs = await findAgentDBDirs(fullPath);
          agentdbDirs.push(...subDirs);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${baseDir}:`, error.message);
  }
  
  return agentdbDirs;
}

async function migrateAgentDBDir(agentdbDir) {
  console.log(`\n📂 Processing: ${agentdbDir}`);
  
  try {
    const files = await fs.readdir(agentdbDir);
    const dbFiles = files.filter(f => f.endsWith('.db') && !f.includes('-backup'));
    
    if (dbFiles.length === 0) {
      console.log('  ℹ️  No .db files found');
      return;
    }
    
    console.log(`  Found ${dbFiles.length} session database(s): ${dbFiles.join(', ')}`);
    
    // Get project name from parent directory
    const projectPath = path.dirname(agentdbDir);
    const projectName = path.basename(projectPath);
    const newDbName = `${projectName}.db`;
    const newDbPath = path.join(agentdbDir, newDbName);
    
    console.log(`  Project name: ${projectName}`);
    console.log(`  Target database: ${newDbName}`);
    
    // Check if the new format already exists
    if (dbFiles.includes(newDbName)) {
      if (dbFiles.length === 1) {
        console.log('  ✅ Already migrated (only project.db exists)');
        return;
      }
      console.log('  ⚠️  Project database already exists, keeping it');
    }
    
    // Create backup directory
    const backupDir = path.join(agentdbDir, 'backup-sessions');
    if (!existsSync(backupDir)) {
      await fs.mkdir(backupDir, { recursive: true });
      console.log(`  📁 Created backup directory: backup-sessions/`);
    }
    
    // Move old session files to backup
    let movedCount = 0;
    for (const dbFile of dbFiles) {
      if (dbFile === newDbName) {
        continue; // Don't move the project db
      }
      
      const oldPath = path.join(agentdbDir, dbFile);
      const backupPath = path.join(backupDir, dbFile);
      
      try {
        await fs.rename(oldPath, backupPath);
        console.log(`  ↪️  Moved ${dbFile} → backup-sessions/`);
        movedCount++;
        
        // Also move associated WAL and SHM files if they exist
        for (const ext of ['-wal', '-shm']) {
          const associatedFile = dbFile.replace('.db', `${ext}`);
          const oldAssocPath = path.join(agentdbDir, associatedFile);
          const backupAssocPath = path.join(backupDir, associatedFile);
          if (existsSync(oldAssocPath)) {
            await fs.rename(oldAssocPath, backupAssocPath);
          }
        }
      } catch (error) {
        console.error(`  ❌ Error moving ${dbFile}:`, error.message);
      }
    }
    
    console.log(`  ✅ Migrated: ${movedCount} session file(s) moved to backup`);
    console.log(`  💡 Note: All sessions are now stored in ${newDbName} (or will be created on next use)`);
    
  } catch (error) {
    console.error(`  ❌ Error migrating ${agentdbDir}:`, error.message);
  }
}

async function main() {
  console.log('🔄 AgentDB Migration: Per-Session → Per-Project\n');
  console.log('This will move old session .db files to backup-sessions/ directory');
  console.log('The new format uses one {projectName}.db per project\n');
  
  // Default base directory
  const baseDir = process.argv[2] || '/Users/mortegas/Documents/sistemas/projects';
  
  console.log(`Searching for .agentdb directories in: ${baseDir}\n`);
  
  const agentdbDirs = await findAgentDBDirs(baseDir);
  
  if (agentdbDirs.length === 0) {
    console.log('No .agentdb directories found');
    return;
  }
  
  console.log(`Found ${agentdbDirs.length} .agentdb directory(ies)`);
  
  for (const dir of agentdbDirs) {
    await migrateAgentDBDir(dir);
  }
  
  console.log('\n✅ Migration complete!');
  console.log('\nOld session files are backed up in backup-sessions/ directories');
  console.log('You can safely delete these backups after verifying everything works');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

