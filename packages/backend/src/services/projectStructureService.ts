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
    
    // Create package.json for JavaScript/TypeScript projects
    try {
      await this.createPackageJson(projectBasePath, techStack);
      
      // Create Jest configuration (jest.config.js, NOT in package.json to avoid conflicts)
      await this.createJestConfig(projectBasePath, techStack);
      
      // Clean up: Remove jest config from package.json if jest.config.js exists
      await this.cleanupJestConfigConflict(projectBasePath);
      
      // Create Vite configuration if React is in tech stack
      await this.createViteConfig(projectBasePath, techStack);
      
      // Create frontend entry files if React is in tech stack
      await this.createFrontendEntryFiles(projectBasePath, techStack);
      
      // Create TypeScript configuration if TypeScript is in tech stack
      await this.createTypeScriptConfig(projectBasePath, techStack);
      
      // Install dependencies
      const installResult = await this.installDependencies(projectBasePath, techStack);
      if (!installResult.success) {
        console.warn('[ProjectStructure] ⚠️ npm install failed, but continuing:', installResult.error);
      }
    } catch (error: any) {
      console.warn('[ProjectStructure] ⚠️ Error setting up project files:', error.message);
      // Don't fail the entire structure creation if this fails
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

  /**
   * Create package.json with basic dependencies for JavaScript/TypeScript projects
   * Includes Jest for testing and Vite for frontend development
   */
  async createPackageJson(projectBasePath: string, techStack?: string): Promise<void> {
    const stackType = this.detectStackType(techStack);
    
    // Only create package.json for Node.js/TypeScript projects
    if (stackType !== 'nodejs') {
      return;
    }
    
    const packageJsonPath = path.join(projectBasePath, 'package.json');
    
    // Check if package.json already exists
    try {
      await fs.access(packageJsonPath);
      console.log('[ProjectStructure] package.json already exists, skipping creation');
      return;
    } catch {
      // package.json doesn't exist, create it
    }
    
    const isTypeScript = techStack?.toLowerCase().includes('typescript') || false;
    const hasReact = techStack?.toLowerCase().includes('react') || false;
    
    const packageJson: any = {
      name: path.basename(projectBasePath),
      version: '1.0.0',
      description: 'Generated by DevFlow Studio',
      type: 'module',
      scripts: {
        test: 'jest',
        'test:watch': 'jest --watch',
        'test:coverage': 'jest --coverage',
        ...(hasReact && {
          'dev': 'vite',
          'build': isTypeScript ? 'tsc && vite build' : 'vite build',
          'preview': 'vite preview'
        }),
        ...(isTypeScript && {
          'type-check': 'tsc --noEmit'
        })
      },
      dependencies: {
        ...(hasReact && {
          'react': '^18.2.0',
          'react-dom': '^18.2.0'
        })
      },
      devDependencies: {
        'jest': '^29.7.0',
        '@types/jest': '^29.5.11',
        ...(isTypeScript && {
          'typescript': '^5.3.3',
          'ts-jest': '^29.1.1',
          '@types/node': '^20.10.0'
        }),
        ...(hasReact && {
          'vite': '^5.0.0',
          '@vitejs/plugin-react': '^4.2.0',
          ...(isTypeScript && {
            '@types/react': '^18.2.43',
            '@types/react-dom': '^18.2.17'
          })
        })
      },
      // Jest configuration is in jest.config.js, not in package.json to avoid conflicts
    };
    
    // Remove undefined values
    if (!isTypeScript) {
      delete packageJson.jest.preset;
    }
    
    try {
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
      console.log('[ProjectStructure] ✅ Created package.json with Jest and Vite configuration');
    } catch (error: any) {
      console.error('[ProjectStructure] Error creating package.json:', error.message);
      throw error;
    }
  }

  /**
   * Create Jest configuration file (jest.config.js)
   * This is separate from package.json to avoid conflicts with jest.config.js files
   */
  async createJestConfig(projectBasePath: string, techStack?: string): Promise<void> {
    const stackType = this.detectStackType(techStack);
    
    // Only create jest.config.js for Node.js/TypeScript projects
    if (stackType !== 'nodejs') {
      return;
    }
    
    const jestConfigPath = path.join(projectBasePath, 'jest.config.js');
    
    // Check if jest.config.js already exists
    try {
      await fs.access(jestConfigPath);
      console.log('[ProjectStructure] jest.config.js already exists, skipping creation');
      return;
    } catch {
      // jest.config.js doesn't exist, create it
    }
    
    const isTypeScript = techStack?.toLowerCase().includes('typescript') || false;
    
    const jestConfigContent = isTypeScript
      ? `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: [
    '<rootDir>/backend/tests',
    '<rootDir>/frontend/tests',
    '<rootDir>/mobile/tests',
    '<rootDir>/tests'
  ],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js',
    '**/__tests__/**/*.tsx',
    '**/?(*.)+(spec|test).tsx'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.tsx$': 'ts-jest'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'backend/src/**/*.{ts,js}',
    'frontend/src/**/*.{ts,tsx}',
    'shared/**/*.{ts,js}',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/*.test.{ts,js,tsx}',
    '!**/*.spec.{ts,js,tsx}'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000
};
`
      : `module.exports = {
  testEnvironment: 'node',
  roots: [
    '<rootDir>/backend/tests',
    '<rootDir>/frontend/tests',
    '<rootDir>/mobile/tests',
    '<rootDir>/tests'
  ],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js',
    '**/__tests__/**/*.jsx',
    '**/?(*.)+(spec|test).jsx'
  ],
  moduleFileExtensions: ['js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'backend/src/**/*.js',
    'frontend/src/**/*.{js,jsx}',
    'shared/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/*.test.js',
    '!**/*.spec.js'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000
};
`;
    
    try {
      await fs.writeFile(jestConfigPath, jestConfigContent, 'utf8');
      console.log('[ProjectStructure] ✅ Created jest.config.js');
    } catch (error: any) {
      console.error('[ProjectStructure] Error creating jest.config.js:', error.message);
      throw error;
    }
  }

  /**
   * Create Vite configuration files for frontend
   */
  async createViteConfig(projectBasePath: string, techStack?: string): Promise<void> {
    const stackType = this.detectStackType(techStack);
    const isTypeScript = techStack?.toLowerCase().includes('typescript') || false;
    const hasReact = techStack?.toLowerCase().includes('react') || false;
    
    // Only create Vite config for Node.js projects with React
    if (stackType !== 'nodejs' || !hasReact) {
      return;
    }
    
    const viteConfigPath = path.join(projectBasePath, 'frontend', isTypeScript ? 'vite.config.ts' : 'vite.config.js');
    
    // Check if vite.config already exists
    try {
      await fs.access(viteConfigPath);
      console.log('[ProjectStructure] vite.config already exists, skipping creation');
      return;
    } catch {
      // vite.config doesn't exist, create it
    }
    
    const configContent = isTypeScript
      ? `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
`
      : `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
`;
    
    try {
      await fs.writeFile(viteConfigPath, configContent, 'utf8');
      console.log('[ProjectStructure] ✅ Created Vite configuration');
    } catch (error: any) {
      console.error('[ProjectStructure] Error creating vite.config:', error.message);
      throw error;
    }
  }

  /**
   * Create basic frontend entry files (index.html, main.tsx/jsx)
   */
  async createFrontendEntryFiles(projectBasePath: string, techStack?: string): Promise<void> {
    const stackType = this.detectStackType(techStack);
    const isTypeScript = techStack?.toLowerCase().includes('typescript') || false;
    const hasReact = techStack?.toLowerCase().includes('react') || false;
    
    // Only create for Node.js projects with React
    if (stackType !== 'nodejs' || !hasReact) {
      return;
    }
    
    const frontendPath = path.join(projectBasePath, 'frontend');
    const publicPath = path.join(frontendPath, 'public');
    const srcPath = path.join(frontendPath, 'src');
    
    // Ensure directories exist
    try {
      await fs.mkdir(srcPath, { recursive: true });
      await fs.mkdir(publicPath, { recursive: true });
    } catch (error: any) {
      // Directories might already exist
    }
    
    // Create index.html in frontend root
    const indexHtmlPath = path.join(frontendPath, 'index.html');
    try {
      await fs.access(indexHtmlPath);
      console.log('[ProjectStructure] index.html already exists, skipping creation');
    } catch {
      const indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${path.basename(projectBasePath)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${isTypeScript ? 'tsx' : 'jsx'}"></script>
  </body>
</html>
`;
      await fs.writeFile(indexHtmlPath, indexHtmlContent, 'utf8');
      console.log('[ProjectStructure] ✅ Created index.html');
    }
    
    // Create main.tsx/jsx
    const mainFile = isTypeScript ? 'main.tsx' : 'main.jsx';
    const mainPath = path.join(srcPath, mainFile);
    try {
      await fs.access(mainPath);
      console.log('[ProjectStructure] main file already exists, skipping creation');
    } catch {
      const mainContent = isTypeScript
        ? `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`
        : `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;
      await fs.writeFile(mainPath, mainContent, 'utf8');
      console.log('[ProjectStructure] ✅ Created main entry file');
    }
    
    // Create App.tsx/jsx
    const appFile = isTypeScript ? 'App.tsx' : 'App.jsx';
    const appPath = path.join(srcPath, appFile);
    try {
      await fs.access(appPath);
      console.log('[ProjectStructure] App file already exists, skipping creation');
    } catch {
      const appContent = isTypeScript
        ? `import React from 'react';

function App() {
  return (
    <div className="App">
      <h1>Welcome to ${path.basename(projectBasePath)}</h1>
      <p>This project was generated by DevFlow Studio</p>
    </div>
  );
}

export default App;
`
        : `import React from 'react';

function App() {
  return (
    <div className="App">
      <h1>Welcome to ${path.basename(projectBasePath)}</h1>
      <p>This project was generated by DevFlow Studio</p>
    </div>
  );
}

export default App;
`;
      await fs.writeFile(appPath, appContent, 'utf8');
      console.log('[ProjectStructure] ✅ Created App component');
    }
    
    // Create basic index.css
    const cssPath = path.join(srcPath, 'index.css');
    try {
      await fs.access(cssPath);
      console.log('[ProjectStructure] index.css already exists, skipping creation');
    } catch {
      const cssContent = `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  min-height: 100vh;
}
`;
      await fs.writeFile(cssPath, cssContent, 'utf8');
      console.log('[ProjectStructure] ✅ Created index.css');
    }
  }

  /**
   * Create TypeScript configuration if needed
   */
  async createTypeScriptConfig(projectBasePath: string, techStack?: string): Promise<void> {
    const isTypeScript = techStack?.toLowerCase().includes('typescript') || false;
    
    if (!isTypeScript) {
      return;
    }
    
    const tsConfigPath = path.join(projectBasePath, 'tsconfig.json');
    
    try {
      await fs.access(tsConfigPath);
      console.log('[ProjectStructure] tsconfig.json already exists, skipping creation');
      return;
    } catch {
      // tsconfig.json doesn't exist, create it
    }
    
    const tsConfig = {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
        baseUrl: '.',
        paths: {
          '@/*': ['./frontend/src/*', './backend/src/*']
        }
      },
      include: ['frontend/src', 'backend/src', 'shared'],
      exclude: ['node_modules', 'dist']
    };
    
    try {
      await fs.writeFile(tsConfigPath, JSON.stringify(tsConfig, null, 2), 'utf8');
      console.log('[ProjectStructure] ✅ Created tsconfig.json');
    } catch (error: any) {
      console.error('[ProjectStructure] Error creating tsconfig.json:', error.message);
      throw error;
    }
  }

  /**
   * Install npm dependencies for JavaScript/TypeScript projects
   */
  async installDependencies(projectBasePath: string, techStack?: string): Promise<{ success: boolean; output: string; error?: string }> {
    const stackType = this.detectStackType(techStack);
    
    // Only install for Node.js/TypeScript projects
    if (stackType !== 'nodejs') {
      return { success: true, output: 'Not a Node.js project, skipping npm install' };
    }
    
    const packageJsonPath = path.join(projectBasePath, 'package.json');
    
    // Check if package.json exists
    try {
      await fs.access(packageJsonPath);
    } catch {
      console.log('[ProjectStructure] package.json not found, skipping npm install');
      return { success: true, output: 'package.json not found' };
    }
    
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      console.log('[ProjectStructure] Installing npm dependencies (this may take a few minutes)...');
      
      const childProcess = spawn('npm', ['install'], {
        cwd: projectBasePath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let output = '';
      let errorOutput = '';
      
      childProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        // Show progress for important lines only
        if (text.includes('added') || text.includes('up to date') || text.includes('found')) {
          process.stdout.write(text);
        }
      });
      
      childProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;
        // Only show warnings/errors
        if (text.toLowerCase().includes('warn') || text.toLowerCase().includes('error')) {
          process.stderr.write(text);
        }
      });
      
      childProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[ProjectStructure] ✅ npm install completed successfully');
          resolve({ success: true, output, error: errorOutput || undefined });
        } else {
          console.error(`[ProjectStructure] ❌ npm install failed with code ${code}`);
          resolve({ success: false, output, error: errorOutput || `npm install exited with code ${code}` });
        }
      });
      
      childProcess.on('error', (error: Error) => {
        console.error('[ProjectStructure] Error running npm install:', error);
        resolve({ success: false, output, error: error.message });
      });
    });
  }

  /**
   * Clean up Jest configuration conflicts
   * Removes jest config from package.json if jest.config.js exists
   */
  async cleanupJestConfigConflict(projectBasePath: string): Promise<void> {
    const packageJsonPath = path.join(projectBasePath, 'package.json');
    const jestConfigPath = path.join(projectBasePath, 'jest.config.js');
    
    try {
      // Check if both exist
      const packageJsonExists = await fs.access(packageJsonPath).then(() => true).catch(() => false);
      const jestConfigExists = await fs.access(jestConfigPath).then(() => true).catch(() => false);
      
      if (!packageJsonExists || !jestConfigExists) {
        return; // No conflict
      }
      
      // Read package.json
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);
      
      // Check if jest config exists in package.json
      if (packageJson.jest) {
        console.log('[ProjectStructure] ⚠️ Found jest config in package.json and jest.config.js - removing from package.json');
        delete packageJson.jest;
        
        // Write back without jest config
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
        console.log('[ProjectStructure] ✅ Removed jest config from package.json (using jest.config.js instead)');
      }
    } catch (error: any) {
      console.warn('[ProjectStructure] ⚠️ Error cleaning up Jest config conflict:', error.message);
      // Don't fail if cleanup fails
    }
  }
}
