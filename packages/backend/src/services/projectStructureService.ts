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
   * Uses MVC structure: backend/, frontend/, mobile/, shared/
   */
  getRecommendedStructure(techStack?: string): ProjectStructure {
    const stackType = this.detectStackType(techStack);
    
    // Base MVC structure (common to all)
    const baseStructure = [
      'backend',
      'frontend',
      'mobile',
      'shared',
      'database',
      'docs',
      'tools',
      'infra',
    ];
    
    switch (stackType) {
      case 'nodejs':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/src',
            'backend/src/controllers',
            'backend/src/models',
            'backend/src/services',
            'backend/src/routes',
            'backend/src/middleware',
            'backend/src/config',
            'backend/tests',
            // Frontend structure
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/src/hooks',
            'frontend/src/utils',
            'frontend/src/services',
            'frontend/src/styles',
            'frontend/public',
            'frontend/tests',
            // Mobile structure
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/src/services',
            'mobile/src/navigation',
            'mobile/src/utils',
            'mobile/tests',
            // Shared code
            'shared/types',
            'shared/utils',
            'shared/constants',
            // Database
            'database/migrations',
            'database/scripts',
            'database/seeds',
          ],
          description: 'Node.js MVC structure with separated backend, frontend, and mobile'
        };
      
      case 'java-spring':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/src/main/java',
            'backend/src/main/java/controllers',
            'backend/src/main/java/models',
            'backend/src/main/java/services',
            'backend/src/main/java/repositories',
            'backend/src/main/resources',
            'backend/src/test/java',
            // Frontend
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/public',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/tests',
            // Database
            'database/migrations',
            'database/scripts',
          ],
          description: 'Java/Spring Boot MVC structure'
        };
      
      case 'python':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/src',
            'backend/src/controllers',
            'backend/src/models',
            'backend/src/services',
            'backend/src/views',
            'backend/src/routes',
            'backend/tests',
            // Frontend
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/public',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/tests',
            // Database
            'database/migrations',
            'database/scripts',
          ],
          description: 'Python MVC structure (Django/Flask/FastAPI)'
        };
      
      case 'frontend':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Frontend only
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/src/hooks',
            'frontend/src/utils',
            'frontend/src/services',
            'frontend/src/styles',
            'frontend/public',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/src/services',
            'mobile/src/navigation',
            'mobile/src/utils',
            'mobile/tests',
            // Shared code
            'shared/types',
            'shared/utils',
            'shared/constants',
          ],
          description: 'Frontend MVC structure (React/Next.js/React Native)'
        };
      
      case 'dotnet':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/src',
            'backend/src/Controllers',
            'backend/src/Models',
            'backend/src/Services',
            'backend/src/Views',
            'backend/src/Data',
            'backend/tests',
            // Frontend
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/public',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/tests',
            // Database
            'database/migrations',
            'database/scripts',
          ],
          description: '.NET/C# MVC structure'
        };
      
      case 'go':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/cmd',
            'backend/internal',
            'backend/internal/handlers',
            'backend/internal/models',
            'backend/internal/services',
            'backend/internal/repositories',
            'backend/tests',
            // Frontend
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/public',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/tests',
            // Database
            'database/migrations',
            'database/scripts',
          ],
          description: 'Go MVC structure'
        };
      
      case 'rust':
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/src',
            'backend/src/controllers',
            'backend/src/models',
            'backend/src/services',
            'backend/src/routes',
            'backend/tests',
            // Frontend
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/public',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/tests',
            // Database
            'database/migrations',
            'database/scripts',
          ],
          description: 'Rust MVC structure'
        };
      
      default:
        return {
          basePath: '',
          directories: [
            ...baseStructure,
            // Backend MVC structure
            'backend/src',
            'backend/src/controllers',
            'backend/src/models',
            'backend/src/services',
            'backend/src/routes',
            'backend/tests',
            // Frontend
            'frontend/src',
            'frontend/src/components',
            'frontend/src/pages',
            'frontend/tests',
            // Mobile
            'mobile/src',
            'mobile/src/screens',
            'mobile/src/components',
            'mobile/tests',
            // Database
            'database/migrations',
            'database/scripts',
          ],
          description: 'Generic MVC structure'
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

This project uses a **MVC (Model-View-Controller) structure** optimized for ${techStack || 'this tech stack'}.

## Structure Description
${structure.description}

## MVC Layout

\`\`\`
/proyecto/
├── 📂 backend/                 # Backend API (MVC pattern)
│   ├── controllers/           # Controladores (rutas y lógica de request/response)
│   ├── models/                # Modelos de datos (entidades, schemas)
│   ├── services/              # Lógica de negocio
│   ├── routes/                # Definición de rutas
│   ├── middleware/            # Middleware (auth, validación, etc.)
│   ├── config/                # Configuración
│   └── tests/                 # Tests del backend
│
├── 📂 frontend/                # Frontend Web (React, Next.js, Vue, etc.)
│   ├── src/
│   │   ├── components/       # Componentes reutilizables
│   │   ├── pages/             # Páginas/vistas
│   │   ├── hooks/              # Custom hooks
│   │   ├── services/           # Servicios API
│   │   └── utils/              # Utilidades
│   ├── public/                 # Archivos estáticos
│   └── tests/                  # Tests del frontend
│
├── 📂 mobile/                  # Aplicación móvil (React Native, Flutter, etc.)
│   └── src/
│       ├── screens/           # Pantallas
│       ├── components/         # Componentes
│       ├── services/           # Servicios API
│       ├── navigation/         # Navegación
│       └── utils/              # Utilidades
│   └── tests/                  # Tests del mobile
│
├── 📂 shared/                  # Código compartido entre frontend/mobile/backend
│   ├── types/                 # Tipos TypeScript/interfaces
│   ├── utils/                 # Utilidades compartidas
│   └── constants/             # Constantes compartidas
│
├── 📂 database/                # Base de datos
│   ├── migrations/            # Migraciones
│   ├── scripts/                # Scripts SQL
│   └── seeds/                  # Datos de prueba
│
├── 📂 docs/                    # Documentación
├── 📂 tools/                   # Scripts de automatización
└── 📂 infra/                   # Infraestructura (Docker, K8s, Terraform)
\`\`\`

## Directory Layout
${structure.directories.map(dir => `- \`${dir}/\` - ${this.getDirectoryDescription(dir, this.detectStackType(techStack))}`).join('\n')}

## Guidelines

### Backend (MVC Pattern)
- **\`controllers/\`**: Manejan las peticiones HTTP, validan entrada, llaman a servicios
- **\`models/\`**: Definen la estructura de datos (entidades, schemas, DTOs)
- **\`services/\`**: Contienen la lógica de negocio principal
- **\`routes/\`**: Definen las rutas y endpoints de la API
- **\`middleware/\`**: Interceptan requests (autenticación, validación, logging)
- **\`tests/\`**: Tests unitarios e integración del backend

### Frontend
- **\`components/\`**: Componentes de UI reutilizables
- **\`pages/\`**: Páginas/vistas principales
- **\`services/\`**: Clientes API para comunicarse con el backend
- **\`hooks/\`**: Custom React hooks
- **\`utils/\`**: Funciones auxiliares
- **\`tests/\`**: Tests unitarios y de integración del frontend

### Mobile
- **\`screens/\`**: Pantallas de la aplicación móvil
- **\`components/\`**: Componentes reutilizables
- **\`services/\`**: Clientes API
- **\`navigation/\`**: Configuración de navegación
- **\`tests/\`**: Tests unitarios y de integración del mobile

### Shared
- Código compartido entre frontend, mobile y backend
- Tipos TypeScript, constantes, utilidades comunes

### Database
- Migraciones, scripts SQL, seeds para datos de prueba

### Tools
- Scripts de automatización, generadores de código, y herramientas de desarrollo

### Infra
- Configuración de infraestructura: Terraform, Docker Compose, Kubernetes, CI/CD

### Docs
- Documentación del proyecto: PRD, Architecture, ADRs, etc.

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
   * Returns paths within the MVC structure
   */
  getRecommendedPath(fileName: string, fileType: 'backend' | 'frontend' | 'mobile' | 'test' | 'config' | 'database' | 'docs', techStack?: string): string {
    const stackType = this.detectStackType(techStack);
    
    let baseDir = '';
    
    switch (fileType) {
      case 'backend':
        if (stackType === 'java-spring') {
          baseDir = 'backend/src/main/java';
        } else if (stackType === 'python') {
          baseDir = 'backend/src';
        } else if (stackType === 'dotnet') {
          baseDir = 'backend/src';
        } else if (stackType === 'go') {
          baseDir = 'backend/internal';
        } else if (stackType === 'rust') {
          baseDir = 'backend/src';
        } else {
          // Node.js default
          baseDir = 'backend/src';
        }
        break;
      
      case 'frontend':
        baseDir = 'frontend/src';
        break;
      
      case 'mobile':
        baseDir = 'mobile/src';
        break;
      
      case 'test':
        // Tests go in the appropriate directory
        if (stackType === 'java-spring') {
          baseDir = 'backend/src/test/java';
        } else {
          baseDir = 'backend/tests';
        }
        break;
      
      case 'config':
        baseDir = 'backend/config';
        break;
      
      case 'database':
        baseDir = 'database';
        break;
      
      case 'docs':
        baseDir = 'docs';
        break;
    }
    
    return path.join(baseDir, fileName);
  }
}
