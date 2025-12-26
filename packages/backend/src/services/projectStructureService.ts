import * as fs from 'fs/promises';
import * as path from 'path';

export interface ProjectStructure {
  basePath: string;
  directories: string[];
  description: string;
}

export class ProjectStructureService {
  /**
   * Detect tech stack type from tech_stack string
   */
  private detectStackType(techStack?: string): string {
    if (!techStack) return 'generic';
    
    const stack = techStack.toLowerCase();
    
    // Java/Spring Boot
    if (stack.includes('java') || stack.includes('spring')) {
      return 'java-spring';
    }
    
    // Node.js/Express/React
    if (stack.includes('node') || stack.includes('nodejs') || stack.includes('express') || 
        stack.includes('react') || stack.includes('next.js') || stack.includes('nestjs')) {
      return 'nodejs';
    }
    
    // Python/Django/Flask
    if (stack.includes('python') || stack.includes('django') || stack.includes('flask') || 
        stack.includes('fastapi')) {
      return 'python';
    }
    
    // Frontend only (React, Vue, Angular)
    if (stack.includes('vue') || stack.includes('angular') || 
        (stack.includes('react') && !stack.includes('node'))) {
      return 'frontend';
    }
    
    // .NET
    if (stack.includes('.net') || stack.includes('csharp') || stack.includes('asp.net')) {
      return 'dotnet';
    }
    
    // Go
    if (stack.includes('go') || stack.includes('golang')) {
      return 'go';
    }
    
    // Rust
    if (stack.includes('rust')) {
      return 'rust';
    }
    
    return 'generic';
  }

  /**
   * Get recommended directory structure for a tech stack
   * Uses monorepo structure: apps/, packages/, tools/, infra/
   */
  getRecommendedStructure(techStack?: string): ProjectStructure {
    const stackType = this.detectStackType(techStack);
    
    // Base monorepo structure (common to all)
    const baseStructure = [
      'apps',
      'packages',
      'tools',
      'infra',
      'docs',
    ];
    
    switch (stackType) {
      case 'java-spring':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/api-gateway',
            'apps/api-gateway/src/main/java',
            'apps/api-gateway/src/main/resources',
            'apps/api-gateway/src/test/java',
            'packages/database',
            'packages/utils',
            'packages/auth-logic',
            'tools',
            'infra',
          ],
          description: 'Java/Spring Boot monorepo structure with apps and packages'
        };
      
      case 'nodejs':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/shop-web',
            'apps/shop-web/src',
            'apps/shop-web/src/components',
            'apps/shop-web/src/pages',
            'apps/customer-app',
            'apps/customer-app/src',
            'apps/admin-dashboard',
            'apps/admin-dashboard/src',
            'apps/api-gateway',
            'apps/api-gateway/src',
            'apps/api-gateway/src/controllers',
            'apps/api-gateway/src/services',
            'apps/api-gateway/src/models',
            'apps/api-gateway/src/routes',
            'apps/api-gateway/src/middleware',
            'packages/ui-components',
            'packages/ui-components/src',
            'packages/auth-logic',
            'packages/auth-logic/src',
            'packages/utils',
            'packages/utils/src',
            'packages/database',
            'packages/database/migrations',
            'packages/database/scripts',
            'tools',
            'infra',
          ],
          description: 'Node.js monorepo structure with Next.js, React Native, React, and NestJS apps'
        };
      
      case 'python':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/api-gateway',
            'apps/api-gateway/src',
            'apps/api-gateway/src/app',
            'apps/api-gateway/src/app/models',
            'apps/api-gateway/src/app/views',
            'apps/api-gateway/src/app/controllers',
            'apps/api-gateway/src/app/services',
            'packages/utils',
            'packages/auth-logic',
            'packages/database',
            'packages/database/migrations',
            'tools',
            'infra',
          ],
          description: 'Python monorepo structure (Django/Flask/FastAPI)'
        };
      
      case 'frontend':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/shop-web',
            'apps/shop-web/src',
            'apps/shop-web/src/components',
            'apps/shop-web/src/pages',
            'apps/customer-app',
            'apps/customer-app/src',
            'apps/admin-dashboard',
            'apps/admin-dashboard/src',
            'packages/ui-components',
            'packages/ui-components/src',
            'packages/utils',
            'packages/utils/src',
            'tools',
            'infra',
          ],
          description: 'Frontend monorepo structure (React/Next.js/React Native)'
        };
      
      case 'dotnet':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/api-gateway',
            'apps/api-gateway/src',
            'apps/api-gateway/src/Controllers',
            'apps/api-gateway/src/Services',
            'apps/api-gateway/src/Models',
            'apps/api-gateway/src/Data',
            'packages/utils',
            'packages/auth-logic',
            'packages/database',
            'packages/database/migrations',
            'tools',
            'infra',
          ],
          description: '.NET/C# monorepo structure'
        };
      
      case 'go':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/api-gateway',
            'apps/api-gateway/cmd',
            'apps/api-gateway/internal',
            'apps/api-gateway/internal/handlers',
            'apps/api-gateway/internal/services',
            'apps/api-gateway/internal/models',
            'packages/utils',
            'packages/auth-logic',
            'packages/database',
            'packages/database/migrations',
            'tools',
            'infra',
          ],
          description: 'Go monorepo structure with standard layout'
        };
      
      case 'rust':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/api-gateway',
            'apps/api-gateway/src',
            'apps/api-gateway/src/bin',
            'apps/api-gateway/src/lib',
            'packages/utils',
            'packages/auth-logic',
            'packages/database',
            'packages/database/migrations',
            'tools',
            'infra',
          ],
          description: 'Rust monorepo structure'
        };
      
      default:
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            'apps/api-gateway',
            'apps/api-gateway/src',
            'packages/ui-components',
            'packages/utils',
            'packages/auth-logic',
            'packages/database',
            'tools',
            'infra',
          ],
          description: 'Generic monorepo structure'
        };
    }
  }

  /**
   * Create directory structure for a project
   */
  async createProjectStructure(projectBasePath: string, techStack?: string): Promise<void> {
    const structure = this.getRecommendedStructure(techStack);
    
    console.log(`[ProjectStructure] Verifying project structure for ${projectBasePath}`);
    let createdCount = 0;
    let existingCount = 0;
    
    // Create all directories
    for (const dir of structure.directories) {
      const fullPath = path.join(projectBasePath, dir);
      try {
        // Check if directory already exists before creating
        let directoryExisted = false;
        try {
          const stats = await fs.stat(fullPath);
          directoryExisted = stats.isDirectory();
        } catch {
          // Directory doesn't exist, will be created
        }
        
        // Create directory (recursive: true won't error if parent exists)
        await fs.mkdir(fullPath, { recursive: true });
        
        // Only log if directory was actually created (didn't exist before)
        if (!directoryExisted) {
          createdCount++;
          console.log(`  ✅ Created: ${dir}`);
        } else {
          existingCount++;
        }
      } catch (error: any) {
        // Ignore if directory already exists
        if (error.code !== 'EEXIST') {
          console.error(`  ❌ Error creating ${dir}:`, error.message);
        }
      }
    }
    
    if (createdCount > 0) {
      console.log(`[ProjectStructure] ✅ Created ${createdCount} new director${createdCount === 1 ? 'y' : 'ies'}, ${existingCount} already existed`);
    } else {
      console.log(`[ProjectStructure] ℹ️  All ${existingCount} directories already exist, no changes needed`);
    }
    
    // Create a .gitkeep file in empty directories to ensure they're tracked
    for (const dir of structure.directories) {
      const fullPath = path.join(projectBasePath, dir);
      const gitkeepPath = path.join(fullPath, '.gitkeep');
      try {
        await fs.access(gitkeepPath);
        // .gitkeep exists, skip
      } catch {
        // .gitkeep doesn't exist, create it
        try {
          await fs.writeFile(gitkeepPath, '# This file ensures the directory is tracked by git\n');
        } catch (error) {
          // Ignore errors
        }
      }
    }
    
    // Create README in project root explaining the structure
    const readmePath = path.join(projectBasePath, 'PROJECT_STRUCTURE.md');
    const readmeContent = `# Project Structure

This project uses a **monorepo structure** optimized for ${techStack || 'this tech stack'}.

## Structure Description
${structure.description}

## Monorepo Layout

\`\`\`
/root-monorepo
├── 📂 apps/                # Aplicaciones desplegables (Binaries/Executables)
│   ├── 🌐 shop-web         # Next.js (Frontend cliente)
│   ├── 📱 customer-app     # React Native (App móvil)
│   ├── ⚙️ admin-dashboard  # React (Panel interno)
│   └── 💻 api-gateway      # NestJS/Express (Backend principal)
│
├── 📂 packages/            # Librerías internas y compartidas (Local Packages)
│   ├── 🎨 ui-components    # Sistema de diseño (React + Tailwind)
│   ├── 🔐 auth-logic       # Funciones de autenticación y JWT
│   ├── 🛠️ utils            # Helpers globales, validaciones, formatos
│   └── 📊 database         # Esquemas de Prisma/TypeORM y migraciones
│
├── 📂 tools/               # Scripts de automatización y generadores
├── 📂 infra/               # Terraform, Docker, Kubernetes (Global)
└── 📂 docs/                # Documentación del proyecto
\`\`\`

## Directory Layout
${structure.directories.map(dir => `- \`${dir}/\` - ${this.getDirectoryDescription(dir, this.detectStackType(techStack))}`).join('\n')}

## Guidelines

### Apps (Aplicaciones desplegables)
- **\`apps/shop-web\`**: Frontend cliente (Next.js, React, Vue, etc.)
- **\`apps/customer-app\`**: Aplicación móvil (React Native, Flutter, etc.)
- **\`apps/admin-dashboard\`**: Panel de administración interno
- **\`apps/api-gateway\`**: Backend principal (NestJS, Express, Spring Boot, etc.)

### Packages (Librerías compartidas)
- **\`packages/ui-components\`**: Componentes de UI reutilizables
- **\`packages/auth-logic\`**: Lógica de autenticación y autorización
- **\`packages/utils\`**: Utilidades y helpers compartidos
- **\`packages/database\`**: Esquemas, migraciones y modelos de base de datos

### Tools
- Scripts de automatización, generadores de código, y herramientas de desarrollo

### Infra
- Configuración de infraestructura: Terraform, Docker Compose, Kubernetes, CI/CD

### Docs
- Documentación del proyecto: PRD, Architecture, ADRs, etc.

## Workspace Configuration

This monorepo uses npm/pnpm/yarn workspaces. Configure in root \`package.json\`:

\`\`\`json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
\`\`\`

This structure was automatically generated by DevFlow Studio.
`;
    
    try {
      await fs.writeFile(readmePath, readmeContent, 'utf8');
    } catch (error) {
      console.error('Error creating PROJECT_STRUCTURE.md:', error);
    }
  }

  /**
   * Get description for a directory based on stack type
   */
  private getDirectoryDescription(dir: string, stackType: string): string {
    const dirLower = dir.toLowerCase();
    
    if (dirLower.includes('test') || dirLower.includes('spec')) {
      return 'Test files';
    }
    if (dirLower.includes('docs') || dirLower.includes('documentation')) {
      return 'Documentation files';
    }
    if (dirLower.includes('database') || dirLower.includes('db') || dirLower.includes('migration')) {
      return 'Database files and migrations';
    }
    if (dirLower.includes('config') || dirLower.includes('configuration')) {
      return 'Configuration files';
    }
    if (dirLower.includes('frontend') || dirLower.includes('client') || dirLower.includes('components') || dirLower.includes('pages')) {
      return 'Frontend code';
    }
    if (dirLower.includes('backend') || dirLower.includes('server') || dirLower.includes('api') || 
        dirLower.includes('controllers') || dirLower.includes('services') || dirLower.includes('models') ||
        dirLower.includes('handlers') || dirLower.includes('routes')) {
      return 'Backend code';
    }
    if (dirLower.includes('src') || dirLower.includes('source')) {
      return 'Source code';
    }
    
    return 'Project files';
  }

  /**
   * Get recommended file path based on file type and stack
   * Returns paths within the monorepo structure
   */
  getRecommendedPath(fileName: string, fileType: 'backend' | 'frontend' | 'test' | 'config' | 'database' | 'docs', techStack?: string): string {
    const stackType = this.detectStackType(techStack);
    
    let baseDir = '';
    
    switch (fileType) {
      case 'backend':
        if (stackType === 'java-spring') {
          baseDir = 'apps/api-gateway/src/main/java';
        } else if (stackType === 'python') {
          baseDir = 'apps/api-gateway/src/app';
        } else if (stackType === 'dotnet') {
          baseDir = 'apps/api-gateway/src';
        } else if (stackType === 'go') {
          baseDir = 'apps/api-gateway/internal';
        } else if (stackType === 'rust') {
          baseDir = 'apps/api-gateway/src';
        } else {
          // Node.js default
          baseDir = 'apps/api-gateway/src';
        }
        break;
      
      case 'frontend':
        if (stackType === 'frontend') {
          baseDir = 'apps/shop-web/src';
        } else {
          // Full-stack: default to shop-web
          baseDir = 'apps/shop-web/src';
        }
        break;
      
      case 'test':
        // Tests go in the app/package where they belong
        // For now, default to api-gateway tests
        baseDir = 'apps/api-gateway/tests';
        break;
      
      case 'config':
        // Config can be at root or in specific apps
        baseDir = 'apps/api-gateway/config';
        break;
      
      case 'database':
        baseDir = 'packages/database';
        break;
      
      case 'docs':
        baseDir = 'docs';
        break;
    }
    
    return path.join(baseDir, fileName);
  }
}
