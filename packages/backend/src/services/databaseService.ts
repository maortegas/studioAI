import { ProjectRepository } from '../repositories/projectRepository';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

export class DatabaseService {
  private projectRepo: ProjectRepository;

  constructor() {
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Sanitiza el nombre del proyecto para usarlo como nombre de base de datos
   */
  private sanitizeDatabaseName(projectName: string): string {
    return projectName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 63);
  }

  /**
   * Verifica si el proyecto tiene Prisma configurado
   */
  async hasPrisma(projectId: string): Promise<boolean> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      return false;
    }

    const schemaPath = path.join(project.base_path, 'prisma', 'schema.prisma');
    const packageJsonPath = path.join(project.base_path, 'package.json');

    try {
      // Verificar schema.prisma
      await fs.access(schemaPath);
      return true;
    } catch {
      // Schema no existe, verificar package.json
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        return 'prisma' in deps || '@prisma/client' in deps;
      } catch {
        return false;
      }
    }
  }

  /**
   * Obtiene el estado de la base de datos
   */
  async getDatabaseStatus(projectId: string): Promise<'not_initialized' | 'initialized' | 'unknown'> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      return 'unknown';
    }

    const envPath = path.join(project.base_path, '.env');
    try {
      await fs.access(envPath);
      // Si existe .env, asumimos que puede estar inicializada
      // Una verificación más precisa requeriría conectar a la BD
      return 'initialized';
    } catch {
      return 'not_initialized';
    }
  }

  /**
   * Verifica el estado de Docker
   */
  async getDockerStatus(projectId: string): Promise<{
    status: 'not_configured' | 'stopped' | 'running';
    containerName?: string;
    databaseName?: string;
  }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const dockerComposePath = path.join(project.base_path, 'docker-compose.yml');
    try {
      await fs.access(dockerComposePath);
    } catch {
      return { status: 'not_configured' };
    }

    const dbName = this.sanitizeDatabaseName(project.name);
    const containerName = `${dbName}_postgres`;

    const isRunning = await this.isContainerRunning(containerName);
    return {
      status: isRunning ? 'running' : 'stopped',
      containerName,
      databaseName: dbName,
    };
  }

  /**
   * Crea/inicializa la base de datos
   */
  async createDatabase(
    projectId: string,
    command: 'migrate' | 'push' = 'push'
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const projectPath = project.base_path;
    const dbName = this.sanitizeDatabaseName(project.name);
    const containerName = `${dbName}_postgres`;

    // 1. Verificar que docker-compose.yml existe
    const dockerComposePath = path.join(projectPath, 'docker-compose.yml');
    try {
      await fs.access(dockerComposePath);
    } catch {
      return {
        success: false,
        output: '',
        error: 'docker-compose.yml not found. Please ensure the project was created with Prisma support.',
      };
    }

    // 2. Verificar si el contenedor ya está corriendo
    const isRunning = await this.isContainerRunning(containerName);

    if (!isRunning) {
      // 3. Iniciar PostgreSQL con Docker Compose
      console.log(`[DatabaseService] Starting PostgreSQL container: ${containerName}...`);
      const dockerUpResult = await this.executeCommand(projectPath, 'docker', [
        'compose',
        'up',
        '-d',
        'postgres',
      ]);

      if (!dockerUpResult.success) {
        return {
          success: false,
          output: dockerUpResult.output,
          error: `Failed to start PostgreSQL: ${dockerUpResult.error}`,
        };
      }

      // 4. Esperar a que PostgreSQL esté listo
      console.log(`[DatabaseService] Waiting for PostgreSQL to be ready...`);
      try {
        await this.waitForPostgreSQL(projectPath, containerName, 30);
      } catch (error: any) {
        return {
          success: false,
          output: '',
          error: `PostgreSQL did not become ready: ${error.message}`,
        };
      }
    } else {
      console.log(`[DatabaseService] PostgreSQL container is already running`);
    }

    // 5. Verificar que la base de datos existe (crearla si no existe)
    await this.ensureDatabaseExists(containerName, dbName);

    // 6. Ejecutar comando de Prisma
    console.log(`[DatabaseService] Executing Prisma ${command}...`);
    const prismaCommand =
      command === 'migrate'
        ? ['prisma', 'migrate', 'dev', '--name', 'init']
        : ['prisma', 'db', 'push'];

    const prismaResult = await this.executeCommand(projectPath, 'npx', prismaCommand);

    if (!prismaResult.success) {
      return {
        success: false,
        output: prismaResult.output,
        error: `Prisma ${command} failed: ${prismaResult.error}`,
      };
    }

    // 7. Generar cliente Prisma
    console.log(`[DatabaseService] Generating Prisma client...`);
    const generateResult = await this.executeCommand(projectPath, 'npx', ['prisma', 'generate']);

    return {
      success: true,
      output: `PostgreSQL started successfully.\nDatabase: ${dbName}\nContainer: ${containerName}\n\n${prismaResult.output}\n${generateResult.output}`,
    };
  }

  /**
   * Encuentra un puerto disponible para PostgreSQL
   */
  private async findAvailablePort(startPort: number = 5432, maxAttempts: number = 10): Promise<number> {
    const net = require('net');
    
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      const isAvailable = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
          server.once('close', () => resolve(true));
          server.close();
        });
        server.on('error', () => resolve(false));
      });
      
      if (isAvailable) {
        return port;
      }
    }
    
    // Si no se encuentra puerto disponible, lanzar error
    throw new Error(`No available port found in range ${startPort}-${startPort + maxAttempts - 1}`);
  }

  /**
   * Verifica si un puerto está en uso
   */
  private async isPortInUse(port: number): Promise<boolean> {
    const net = require('net');
    return new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.once('close', () => resolve(false));
        server.close();
      });
      server.on('error', () => resolve(true));
    });
  }

  /**
   * Genera la infraestructura de base de datos (docker-compose.yml, .env)
   */
  async generateDatabaseInfrastructure(basePath: string, projectName: string): Promise<void> {
    const dbName = this.sanitizeDatabaseName(projectName);
    const dbUser = 'postgres';
    const dbPassword = 'postgres';
    
    // Intentar usar puerto 5432, si está ocupado buscar uno disponible
    let dbPort: number;
    try {
      const isPort5432InUse = await this.isPortInUse(5432);
      if (isPort5432InUse) {
        console.log(`[DatabaseService] Port 5432 is in use, finding alternative port...`);
        dbPort = await this.findAvailablePort(5433, 20); // Buscar desde 5433 hasta 5452
        console.log(`[DatabaseService] Using port ${dbPort} instead of 5432`);
      } else {
        dbPort = 5432;
      }
    } catch (error: any) {
      console.warn(`[DatabaseService] Could not check port availability, using 5433: ${error.message}`);
      dbPort = 5433; // Fallback a 5433
    }
    
    const containerName = `${dbName}_postgres`;

    // 1. Generar docker-compose.yml
    const dockerComposeContent = `version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: ${containerName}
    environment:
      POSTGRES_USER: ${dbUser}
      POSTGRES_PASSWORD: ${dbPassword}
      POSTGRES_DB: ${dbName}
    ports:
      - "${dbPort}:5432"
    volumes:
      - ${dbName}_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${dbUser}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  ${dbName}_postgres_data:
`;

    const dockerComposePath = path.join(basePath, 'docker-compose.yml');
    await fs.writeFile(dockerComposePath, dockerComposeContent, 'utf-8');
    console.log(`[DatabaseService] ✅ Created docker-compose.yml at: ${dockerComposePath}`);

    // 2. Generar .env con DATABASE_URL usando nombre del proyecto
    const databaseUrl = `postgresql://${dbUser}:${dbPassword}@localhost:${dbPort}/${dbName}?schema=public`;
    
    // Nota sobre el puerto si no es el estándar
    const portNote = dbPort !== 5432 ? `\n# Note: Using port ${dbPort} because 5432 is already in use` : '';

    const envContent = `# Database Configuration
# Generated automatically by DevFlow Studio
# Database name: ${dbName} (based on project name: ${projectName})${portNote}

DATABASE_URL="${databaseUrl}"

# PostgreSQL Connection (for direct access)
DB_HOST=localhost
DB_PORT=${dbPort}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
DB_NAME=${dbName}

# Environment
NODE_ENV=development
`;

    const envPath = path.join(basePath, '.env');
    await fs.writeFile(envPath, envContent, 'utf-8');
    console.log(`[DatabaseService] ✅ Created .env at: ${envPath}`);

    // 3. Generar .env.example
    const envExampleContent = `# Database Configuration
# Copy this file to .env and update with your values
# Database name: ${dbName} (based on project name: ${projectName})

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${dbName}?schema=public"

# PostgreSQL Connection
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=${dbName}

# Environment
NODE_ENV=development
`;

    const envExamplePath = path.join(basePath, '.env.example');
    await fs.writeFile(envExamplePath, envExampleContent, 'utf-8');
    console.log(`[DatabaseService] ✅ Created .env.example at: ${envExamplePath}`);

    // 4. Actualizar .gitignore si existe
    const gitignorePath = path.join(basePath, '.gitignore');
    try {
      let gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      if (!gitignoreContent.includes('.env')) {
        gitignoreContent += '\n# Environment variables\n.env\n.env.local\n.env.*.local\n';
        await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      }
    } catch {
      // .gitignore no existe, crear uno básico
      const gitignoreContent = `# Dependencies
node_modules/
.pnp
.pnp.js

# Environment variables
.env
.env.local
.env.*.local

# Logs
logs
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Build
dist/
build/
*.tsbuildinfo
`;
      await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
    }

    // 5. Iniciar Docker automáticamente
    console.log(`[DatabaseService] 🐳 Starting PostgreSQL container on port ${dbPort}...`);
    try {
      await this.startDockerContainer(basePath, containerName);
    } catch (error: any) {
      // Si falla por puerto ocupado, informar al usuario con mensaje útil
      if (error.message && error.message.includes('port is already allocated')) {
        const portMatch = error.message.match(/Port (\d+)/);
        const port = portMatch ? portMatch[1] : dbPort;
        throw new Error(
          `Port ${port} is already in use. ` +
          `Please stop other PostgreSQL containers (docker ps | grep postgres) ` +
          `or regenerate infrastructure to use a different port.`
        );
      }
      // Para otros errores, solo advertir pero no fallar
      console.warn(`[DatabaseService] ⚠️ Could not start Docker automatically: ${error.message}`);
      console.log(`[DatabaseService] ℹ️ You can start it manually with: docker compose up -d`);
    }
  }

  /**
   * Inicia el contenedor de PostgreSQL usando docker-compose
   */
  private async startDockerContainer(basePath: string, containerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const dockerProcess = spawn('docker', ['compose', 'up', '-d', 'postgres'], {
        cwd: basePath,
        stdio: 'pipe',
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      dockerProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      dockerProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      dockerProcess.on('close', (code: number) => {
        if (code === 0) {
          console.log(`[DatabaseService] ✅ Docker container started: ${containerName}`);
          console.log(`[DatabaseService] 📋 Waiting for PostgreSQL to be ready...`);

          // Esperar a que PostgreSQL esté listo
          this.waitForPostgreSQLReady(basePath, containerName)
            .then(() => {
              console.log(`[DatabaseService] ✅ PostgreSQL is ready!`);
              resolve();
            })
            .catch((error) => {
              console.warn(
                `[DatabaseService] ⚠️ PostgreSQL may not be ready yet: ${error.message}`
              );
              // No rechazar, solo advertir
              resolve();
            });
        } else {
          const errorMsg = stderr || `Docker compose exited with code ${code}`;
          console.error(`[DatabaseService] ❌ Failed to start Docker container: ${errorMsg}`);
          
          // Detectar error de puerto ocupado
          if (stderr.includes('port is already allocated') || stderr.includes('Bind for')) {
            const portMatch = stderr.match(/Bind for .*:(\d+)/);
            const port = portMatch ? portMatch[1] : 'unknown';
            console.error(`[DatabaseService] ⚠️ Port ${port} is already in use`);
            console.error(`[DatabaseService] 💡 Solutions:`);
            console.error(`[DatabaseService]   1. Stop other PostgreSQL containers: docker ps | grep postgres`);
            console.error(`[DatabaseService]   2. Stop specific container: docker stop <container_name>`);
            console.error(`[DatabaseService]   3. Or regenerate infrastructure to use a different port`);
            
            // Rechazar con mensaje útil
            reject(new Error(`Port ${port} is already in use. Please stop other PostgreSQL containers or regenerate infrastructure.`));
          } else {
            console.log(
              `[DatabaseService] ℹ️ You can start the database manually with: docker compose up -d`
            );
            resolve(); // Resolver para no bloquear la creación del proyecto
          }
        }
      });

      dockerProcess.on('error', (error: Error) => {
        console.error(`[DatabaseService] ❌ Error starting Docker: ${error.message}`);
        console.log(`[DatabaseService] ℹ️ Make sure Docker is installed and running`);
        console.log(
          `[DatabaseService] ℹ️ You can start the database manually with: docker compose up -d`
        );
        resolve();
      });
    });
  }

  /**
   * Espera a que PostgreSQL esté listo para aceptar conexiones
   */
  private async waitForPostgreSQLReady(
    basePath: string,
    containerName: string,
    timeoutSeconds: number = 30
  ): Promise<void> {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;
    const maxAttempts = timeoutSeconds / 2; // Intentar cada 2 segundos
    let attempts = 0;

    while (attempts < maxAttempts && Date.now() - startTime < timeout) {
      try {
        const result = await new Promise<{ success: boolean }>((resolve) => {
          const checkProcess = spawn('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres'], {
            stdio: 'pipe',
          });

          checkProcess.on('close', (code: number) => {
            resolve({ success: code === 0 });
          });

          checkProcess.on('error', () => {
            resolve({ success: false });
          });
        });

        if (result.success) {
          return; // PostgreSQL está listo
        }
      } catch (error) {
        // Continuar intentando
      }

      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Esperar 2 segundos
    }

    throw new Error(`PostgreSQL did not become ready within ${timeoutSeconds} seconds`);
  }

  /**
   * Verifica si un contenedor está corriendo
   */
  private async isContainerRunning(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec(`docker ps --filter name=${containerName} --format "{{.Names}}"`, (error: any, stdout: string) => {
        if (error || !stdout.trim()) {
          resolve(false);
        } else {
          resolve(stdout.trim() === containerName);
        }
      });
    });
  }

  /**
   * Asegura que la base de datos existe
   */
  private async ensureDatabaseExists(containerName: string, dbName: string): Promise<void> {
    return new Promise((resolve) => {
      const { exec } = require('child_process');

      // Verificar si la base de datos existe
      exec(
        `docker exec ${containerName} psql -U postgres -lqt | cut -d \\| -f 1 | grep -qw ${dbName}`,
        (error: any) => {
          if (error) {
            // Base de datos no existe, crearla
            console.log(`[DatabaseService] Creating database: ${dbName}...`);
            exec(
              `docker exec ${containerName} psql -U postgres -c "CREATE DATABASE ${dbName};"`,
              (createError: any) => {
                if (createError) {
                  // Puede que ya exista o haya otro error, continuar de todas formas
                  console.log(
                    `[DatabaseService] Database ${dbName} may already exist or error occurred`
                  );
                }
                resolve();
              }
            );
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Espera a que PostgreSQL esté listo
   */
  private async waitForPostgreSQL(
    projectPath: string,
    containerName: string,
    timeoutSeconds: number = 30
  ): Promise<void> {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeout) {
      const result = await this.executeCommand(projectPath, 'docker', [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        'postgres',
      ]);

      if (result.success) {
        console.log(`[DatabaseService] PostgreSQL is ready!`);
        return;
      }

      // Esperar 2 segundos antes de intentar de nuevo
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`PostgreSQL did not become ready within ${timeoutSeconds} seconds`);
  }

  /**
   * Ejecuta un comando en el directorio del proyecto
   */
  private async executeCommand(
    cwd: string,
    command: string,
    args: string[]
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const process = spawn(command, args, {
        cwd,
        shell: true,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      process.on('close', (code: number) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr || (code !== 0 ? `Process exited with code ${code}` : undefined),
        });
      });

      process.on('error', (error: Error) => {
        resolve({
          success: false,
          output: '',
          error: error.message,
        });
      });
    });
  }

  /**
   * Instala Prisma en el proyecto
   */
  async installPrisma(projectId: string): Promise<{ success: boolean; output: string; error?: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    console.log(`[DatabaseService] Installing Prisma in project: ${project.name}`);
    return await this.executeCommand(project.base_path, 'npm', ['install', 'prisma', '@prisma/client', '--save-dev']);
  }

  /**
   * Inicializa Prisma en el proyecto
   */
  async initPrisma(projectId: string): Promise<{ success: boolean; output: string; error?: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    console.log(`[DatabaseService] Initializing Prisma in project: ${project.name}`);
    
    // Verificar si ya existe prisma/schema.prisma
    const schemaPath = path.join(project.base_path, 'prisma', 'schema.prisma');
    try {
      await fs.access(schemaPath);
      // Ya existe, no inicializar de nuevo
      return {
        success: true,
        output: 'Prisma already initialized',
      };
    } catch {
      // No existe, inicializar
      return await this.executeCommand(project.base_path, 'npx', ['prisma', 'init']);
    }
  }

  /**
   * Instala e inicializa Prisma en un solo paso
   */
  async setupPrisma(projectId: string): Promise<{ success: boolean; output: string; error?: string }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    console.log(`[DatabaseService] Setting up Prisma for project: ${project.name}`);

    // 1. Instalar Prisma
    const installResult = await this.installPrisma(projectId);
    if (!installResult.success) {
      return {
        success: false,
        output: installResult.output,
        error: `Failed to install Prisma: ${installResult.error}`,
      };
    }

    // 2. Inicializar Prisma
    const initResult = await this.initPrisma(projectId);
    if (!initResult.success) {
      return {
        success: false,
        output: initResult.output,
        error: `Failed to initialize Prisma: ${initResult.error}`,
      };
    }

    // 3. Actualizar schema.prisma con la configuración de PostgreSQL
    const schemaPath = path.join(project.base_path, 'prisma', 'schema.prisma');
    try {
      let schemaContent = await fs.readFile(schemaPath, 'utf-8');
      
      // Verificar si ya tiene DATABASE_URL configurado
      if (!schemaContent.includes('DATABASE_URL')) {
        // Actualizar el datasource para usar PostgreSQL
        schemaContent = schemaContent.replace(
          /datasource db \{[\s\S]*?url\s*=\s*env\("DATABASE_URL"\)[\s\S]*?\}/,
          `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}`
        );
        
        await fs.writeFile(schemaPath, schemaContent, 'utf-8');
        console.log(`[DatabaseService] Updated schema.prisma with PostgreSQL configuration`);
      }
    } catch (error: any) {
      console.warn(`[DatabaseService] Could not update schema.prisma: ${error.message}`);
    }

    return {
      success: true,
      output: `Prisma installed and initialized successfully.\n${installResult.output}\n${initResult.output}`,
    };
  }
}

