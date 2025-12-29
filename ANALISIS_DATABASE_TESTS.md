# Análisis: Tests con Dependencia de Base de Datos

**Fecha**: 2025-12-29
**Pregunta del Usuario**: "cuando un test tenga la dependencia su base de datos, que se realizara en estos casos?"

---

## Resumen Ejecutivo

⚠️ **El sistema DELEGA la creación de bases de datos de test a la IA, NO lo maneja automáticamente**

### Estado Actual:

| Aspecto | Estado | Ubicación | Notas |
|---------|--------|-----------|-------|
| **Creación automática de DB de test** | ❌ NO | - | No existe |
| **Ejecución automática de migrations** | ❌ NO | - | No existe |
| **Seeding automático de datos de test** | ❌ NO | - | No existe |
| **Setup/Teardown automático** | ❌ NO | - | No existe |
| **Instrucciones para mockear DB** | ✅ SÍ | `codingSessionService.ts:811` | En prompt de tests |
| **Generación de archivos DB** | ✅ SÍ | `codingSessionService.ts:1100` | Migrations, seeds |

---

## 1. Enfoque Actual del Sistema

### 1.1 Prompt de Generación de Tests

El sistema **instruye a la IA** para que use mocks de base de datos en tests unitarios.

**Ubicación**: `packages/backend/src/services/codingSessionService.ts:811`

```typescript
// Línea 810-811
lines.push(`   // Mock dependencies if needed\n`);
lines.push(`   jest.mock('../src/config/database');\n`);
```

**Prompt completo para backend tests**:

```javascript
// Import the function/class to test
const { functionToTest } = require('../src/services/myService');
// Or for TypeScript:
// import { functionToTest } from '../src/services/myService';

// Mock dependencies if needed
jest.mock('../src/config/database');
```

### 1.2 Estructura de Archivos de Base de Datos

El sistema **menciona** que se pueden crear archivos de migrations/seeds en `database/`.

**Ubicación**: `packages/backend/src/services/codingSessionService.ts:1100`

```typescript
lines.push(`✅ Database files → \`database/\` (migrations, scripts, seeds)\n`);
```

---

## 2. Lo Que NO Hace el Sistema Automáticamente

### ❌ 2.1 No Crea Base de Datos de Test

El sistema **NO** tiene código que:
- Cree una base de datos separada para tests (ej: `myproject_test`)
- Configure conexiones diferentes para test vs desarrollo
- Aísle el ambiente de test del ambiente de desarrollo

**Evidencia**:
- No hay variables de entorno como `DATABASE_URL_TEST`
- No hay código que detecte `NODE_ENV=test` y cambie la conexión
- No hay scripts de setup de DB de test

### ❌ 2.2 No Ejecuta Migrations Automáticamente

Antes de ejecutar tests, el sistema **NO**:
- Ejecuta migrations en la DB de test
- Crea las tablas necesarias
- Verifica que el schema esté actualizado

**Ubicación esperada pero NO existe**:
- `beforeAll()` hook que ejecute migrations
- Script `setup-test-db.sh`
- Código en worker que ejecute migrations antes de `npm test`

### ❌ 2.3 No Hace Seeding de Datos de Test

El sistema **NO**:
- Carga datos de prueba (fixtures) antes de ejecutar tests
- Crea registros necesarios para los tests
- Resetea los datos entre tests

**Patrones comunes que NO están implementados**:
```javascript
// Esto NO existe en el sistema
beforeEach(async () => {
  await resetDatabase();
  await seedTestData();
});
```

### ❌ 2.4 No Hace Setup/Teardown de Base de Datos

El sistema **NO** implementa:
- `beforeAll()` para crear DB de test
- `afterAll()` para limpiar DB de test
- `beforeEach()` para resetear estado entre tests
- `afterEach()` para limpiar datos creados

---

## 3. Estrategias Actuales (Delegadas a la IA)

### 3.1 Tests Unitarios: Mocks

Para **tests unitarios**, el sistema espera que la IA genere mocks:

**Ejemplo esperado**:
```javascript
// Mock de la base de datos
jest.mock('../src/config/database');

const mockQuery = jest.fn();
const pool = {
  query: mockQuery
};

describe('UserService', () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });

  it('should create user', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, name: 'John' }]
    });

    const result = await userService.createUser({ name: 'John' });

    expect(mockQuery).toHaveBeenCalledWith(
      'INSERT INTO users (name) VALUES ($1) RETURNING *',
      ['John']
    );
    expect(result).toEqual({ id: 1, name: 'John' });
  });
});
```

**Fortaleza**: Funciona bien para tests unitarios aislados

**Debilidad**: No valida que las queries SQL realmente funcionen

### 3.2 Tests de Integración: Depende de la IA

Para **tests de integración** (API endpoints, database operations), el sistema **espera que la IA genere**:

1. Setup de base de datos de test
2. Migrations o schema setup
3. Seeding de datos de prueba
4. Cleanup después de tests

**Ejemplo que la IA debería generar**:
```javascript
const { Pool } = require('pg');

// Base de datos de test
const testPool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || 'postgresql://localhost/myapp_test'
});

describe('User API Integration Tests', () => {
  beforeAll(async () => {
    // Crear tablas
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    // Limpiar datos antes de cada test
    await testPool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    // Limpiar y cerrar conexión
    await testPool.query('DROP TABLE IF EXISTS users');
    await testPool.end();
  });

  it('should create user in database', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'John' });

    expect(response.status).toBe(201);

    // Verificar en DB real
    const result = await testPool.query('SELECT * FROM users WHERE name = $1', ['John']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('John');
  });
});
```

**Fortaleza**: Tests reales contra base de datos

**Debilidad**:
- Depende de que la IA genere código correcto
- No hay validación automática de que se hizo el setup
- No hay infraestructura de soporte

---

## 4. Problemas con el Enfoque Actual

### 4.1 Inconsistencia

Cada vez que la IA genera tests con DB:
- Puede usar diferentes estrategias
- Puede o no incluir setup/teardown
- Puede crear DBs de test con nombres diferentes

### 4.2 Fallos Ocultos

Si la IA no genera el setup correctamente:
- Los tests fallarán con errores de conexión
- No se crearán las tablas necesarias
- Los datos de producción podrían verse afectados (sin DB separada)

### 4.3 Sin Validación Previa

El worker ejecuta `npm test` sin verificar:
- ✓ Que existe una base de datos de test
- ✓ Que las migrations están aplicadas
- ✓ Que hay datos de seed si se necesitan

### 4.4 Intelligent Retry Limitado

El sistema de intelligent retry captura errores de tests, pero:
- No detecta errores de conexión a DB como causa raíz
- No sugiere crear DB de test si falta
- No ejecuta migrations automáticamente

---

## 5. Escenarios Reales y Cómo se Manejan

### Escenario 1: Test Unitario que Consulta DB

**Test**:
```javascript
it('should get user by id', async () => {
  const user = await userService.getUserById(1);
  expect(user.name).toBe('John');
});
```

**¿Qué pasa?**

1. ✅ La IA debería haber generado mock de database:
   ```javascript
   jest.mock('../config/database');
   pool.query.mockResolvedValue({ rows: [{ id: 1, name: 'John' }] });
   ```

2. ❌ Si la IA NO generó el mock:
   - El test intentará conectarse a la DB real
   - Fallará si no hay un usuario con id=1
   - Podría afectar datos reales

3. 🔄 Intelligent retry:
   - Captura el error
   - Construye prompt de corrección
   - Pide a la IA que agregue el mock

### Escenario 2: Test de Integración que Inserta en DB

**Test**:
```javascript
it('should create user in database', async () => {
  const result = await request(app)
    .post('/api/users')
    .send({ name: 'John' });

  expect(result.status).toBe(201);

  // Verificar en DB
  const user = await db.query('SELECT * FROM users WHERE name = $1', ['John']);
  expect(user.rows).toHaveLength(1);
});
```

**¿Qué pasa?**

1. ❌ Si NO existe tabla `users` en DB de test:
   - Error: `relation "users" does not exist`
   - Test falla

2. ❌ Si NO hay setup/teardown:
   - Cada ejecución crea más registros
   - Tests fallan por datos duplicados
   - DB de test se llena de basura

3. 🔄 Intelligent retry:
   - Captura el error "relation does not exist"
   - **PERO** no tiene lógica para detectar que falta crear la tabla
   - Probablemente intente arreglar el SQL query, no el setup

### Escenario 3: Test que Requiere Datos Pre-existentes

**Test**:
```javascript
it('should update existing user', async () => {
  // Asume que existe un user con id=1
  const result = await userService.updateUser(1, { name: 'Jane' });
  expect(result.name).toBe('Jane');
});
```

**¿Qué pasa?**

1. ❌ Si NO hay seeding de datos:
   - No existe user con id=1
   - Test falla: "User not found"

2. ✅ La IA debería haber generado:
   ```javascript
   beforeEach(async () => {
     await db.query('INSERT INTO users (id, name) VALUES (1, \'John\')');
   });
   ```

3. ❌ Si la IA NO generó el beforeEach:
   - Test fallará constantemente
   - Intelligent retry intentará arreglar el código, no el setup

---

## 6. Comparación con Mejores Prácticas

### 6.1 Otros Frameworks/Sistemas

| Sistema | Estrategia | Automático |
|---------|-----------|------------|
| **Rails** | Crea DB de test, ejecuta migrations, resetea entre tests | ✅ Sí |
| **Django** | Crea DB de test, aplica migrations, usa fixtures | ✅ Sí |
| **Laravel** | Migrations automáticas, seeding, RefreshDatabase trait | ✅ Sí |
| **NestJS** | Módulos de testing, in-memory DB (sqlite), fixtures | ⚠️ Configurable |
| **DevFlow Studio** | Delega a la IA | ❌ No |

### 6.2 Patrones Comunes

**Patrón 1: Base de Datos Separada**
```bash
# Variables de entorno
DATABASE_URL=postgresql://localhost/myapp_dev
DATABASE_URL_TEST=postgresql://localhost/myapp_test

# Script de setup
./scripts/setup-test-db.sh  # Crea DB de test
```

**Patrón 2: In-Memory Database**
```javascript
// Use SQLite in-memory for tests
const testDb = new SQLite(':memory:');
```

**Patrón 3: Transacciones Rollback**
```javascript
beforeEach(async () => {
  await db.query('BEGIN');
});

afterEach(async () => {
  await db.query('ROLLBACK');
});
```

**Patrón 4: Docker Test Container**
```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: postgres:14
    environment:
      POSTGRES_DB: myapp_test
```

---

## 7. Impacto en el Flujo TDD Actual

### Flujo Actual con Tests de DB:

```
1. IA genera tests (incluye tests de integración con DB)
   └─ ¿Incluyó setup de DB de test? 🎲 Depende de la IA

2. Worker ejecuta npm test
   └─ ¿Existe DB de test? ❌ NO (probablemente)

3. Tests fallan: "ECONNREFUSED" o "relation does not exist"

4. Intelligent retry captura el error
   └─ ¿Detecta que falta DB de test? ❌ NO
   └─ Construye prompt de corrección genérico

5. IA intenta arreglar el código
   └─ ¿Puede crear DB desde código? ⚠️ Posible pero no ideal

6. Tests fallan de nuevo (misma razón)

7. Retry 3/3 falla

8. Skip al siguiente batch
   └─ ❌ Los tests de DB nunca pasarán
```

### Tasa de Éxito Esperada:

- **Tests unitarios con mocks**: 70-80% (la IA es buena generando mocks)
- **Tests de integración con DB**: 20-30% (requiere setup manual)
- **Tests que requieren migrations**: 10-20% (muy difícil sin infraestructura)

---

## 8. Soluciones Propuestas

### Opción 1: Base de Datos de Test Automática (Recomendado)

**Implementación**:

1. **Detectar tech stack y tipo de DB** (PostgreSQL, MySQL, SQLite, MongoDB)

2. **Crear DB de test automáticamente** antes de ejecutar tests:
   ```typescript
   // En worker.ts, antes de executeBatchTests()
   async function setupTestDatabase(projectPath: string, techStack: string) {
     const packageJson = await readPackageJson(projectPath);

     if (packageJson.dependencies?.pg || packageJson.devDependencies?.pg) {
       // PostgreSQL detected
       const dbName = `${projectName}_test`;
       await exec(`createdb ${dbName} || true`);
       process.env.DATABASE_URL_TEST = `postgresql://localhost/${dbName}`;
     }

     // Ejecutar migrations si existen
     const migrationsPath = path.join(projectPath, 'database/migrations');
     if (await exists(migrationsPath)) {
       await exec(`npm run migrate:test`);
     }
   }
   ```

3. **Modificar prompt de tests** para usar `DATABASE_URL_TEST`:
   ```javascript
   // En test setup
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL
   });
   ```

4. **Limpiar DB después de tests**:
   ```typescript
   async function teardownTestDatabase(dbName: string) {
     await exec(`dropdb ${dbName} --if-exists`);
   }
   ```

**Pros**:
- ✅ Aislamiento total de test vs producción
- ✅ Migrations automáticas
- ✅ Cleanup automático
- ✅ Compatible con mejores prácticas

**Contras**:
- ⚠️ Requiere permisos para crear/borrar DBs
- ⚠️ Solo funciona para DBs locales (no cloud DBs)

### Opción 2: In-Memory Database (Rápido)

**Implementación**:

1. **Detectar si se puede usar SQLite in-memory**:
   ```typescript
   if (techStack.includes('node') && !hasSpecificDB) {
     // Use SQLite in-memory
     process.env.DATABASE_URL_TEST = ':memory:';
   }
   ```

2. **Modificar prompt** para incluir setup de in-memory DB:
   ```javascript
   // Test setup
   const sqlite3 = require('sqlite3');
   const db = new sqlite3.Database(':memory:');

   beforeAll(async () => {
     await db.exec(fs.readFileSync('./schema.sql', 'utf8'));
   });
   ```

**Pros**:
- ✅ Muy rápido (todo en RAM)
- ✅ No requiere permisos especiales
- ✅ Cleanup automático al terminar proceso

**Contras**:
- ❌ Solo funciona para SQLite
- ❌ No prueba contra DB de producción real

### Opción 3: Docker Test Containers (Profesional)

**Implementación**:

1. **Generar docker-compose.test.yml** al crear proyecto:
   ```yaml
   services:
     postgres-test:
       image: postgres:14
       environment:
         POSTGRES_DB: ${PROJECT_NAME}_test
         POSTGRES_PASSWORD: test
       ports:
         - "5433:5432"
   ```

2. **Levantar container antes de tests**:
   ```typescript
   async function setupTestContainer(projectPath: string) {
     await exec('docker-compose -f docker-compose.test.yml up -d', { cwd: projectPath });
     await waitForDB('localhost', 5433);
   }
   ```

3. **Detener container después de tests**:
   ```typescript
   async function teardownTestContainer(projectPath: string) {
     await exec('docker-compose -f docker-compose.test.yml down -v', { cwd: projectPath });
   }
   ```

**Pros**:
- ✅ Aislamiento perfecto
- ✅ Funciona para cualquier DB
- ✅ Reproducible en CI/CD
- ✅ No afecta instalación local

**Contras**:
- ⚠️ Requiere Docker instalado
- ⚠️ Más lento (levantar containers)

### Opción 4: Mocks Inteligentes por Defecto (Pragmático)

**Implementación**:

1. **Modificar prompt de generación de tests** para SIEMPRE incluir mocks:
   ```typescript
   lines.push(`**CRITICAL - Database Testing:**\n`);
   lines.push(`For tests that interact with database:\n`);
   lines.push(`1. ALWAYS mock the database connection\n`);
   lines.push(`2. Use jest.mock() for the database module\n`);
   lines.push(`3. Mock query results instead of using real DB\n\n`);
   lines.push(`Example:\n`);
   lines.push(`\`\`\`javascript\n`);
   lines.push(`jest.mock('../config/database');\n`);
   lines.push(`const mockPool = {\n`);
   lines.push(`  query: jest.fn()\n`);
   lines.push(`};\n`);
   lines.push(`\`\`\`\n\n`);
   ```

2. **Solo para tests de integración explícitos**, incluir setup real de DB

**Pros**:
- ✅ No requiere infraestructura adicional
- ✅ Tests rápidos
- ✅ Funciona desde el primer intento

**Contras**:
- ❌ No prueba queries SQL reales
- ❌ Puede ocultar bugs de SQL

---

## 9. Recomendación Final

### Enfoque Híbrido (Mejor de Ambos Mundos)

**1. Por defecto: Mocks (Opción 4)**
- Tests unitarios siempre usan mocks
- Rápido, confiable, sin infraestructura

**2. Tests de integración: Base de Datos de Test Automática (Opción 1)**
- Detectar cuando se necesitan tests de integración
- Crear DB de test automáticamente
- Ejecutar migrations
- Cleanup después de tests

**3. Configuración por proyecto**:
```json
// package.json
{
  "devflow": {
    "testing": {
      "strategy": "mock", // mock | integration | both
      "database": {
        "type": "postgresql",
        "test_db": "myapp_test",
        "auto_migrate": true,
        "auto_seed": true
      }
    }
  }
}
```

### Implementación Gradual

**Fase 1** (Rápido - 1 semana):
- Mejorar prompts para SIEMPRE incluir mocks de DB
- Agregar validación de setup/teardown en tests
- Mejorar intelligent retry para detectar errores de DB

**Fase 2** (Medio - 2 semanas):
- Implementar creación automática de DB de test para PostgreSQL
- Agregar ejecución automática de migrations
- Agregar cleanup automático

**Fase 3** (Avanzado - 1 mes):
- Soporte para múltiples DBs (MySQL, MongoDB, SQLite)
- Docker test containers
- Seeding automático de datos de test

---

## 10. Conclusión

### Estado Actual: ⚠️ BRECHA SIGNIFICATIVA

El sistema **NO maneja automáticamente las bases de datos de test**:
- ❌ No crea DBs de test
- ❌ No ejecuta migrations
- ❌ No hace seeding
- ❌ No hace setup/teardown

**Consecuencias**:
- Tests de integración fallarán en el primer intento
- Datos de producción pueden verse afectados
- Tasa de éxito baja para tests con DB (20-30%)

### Solución Recomendada:

**Implementar Opción 4 (corto plazo) + Opción 1 (mediano plazo)**:
1. Mejorar prompts para incluir mocks por defecto
2. Agregar infraestructura de DB de test para tests de integración
3. Detectar automáticamente cuándo se necesita cada estrategia

### Impacto Esperado:

| Métrica | Antes | Después |
|---------|-------|---------|
| Tests unitarios con DB (mocks) | 70% éxito | 95% éxito |
| Tests de integración con DB | 20% éxito | 85% éxito |
| Tiempo de setup manual | 15+ min | 0 min (automático) |
| Riesgo de afectar producción | Alto | Cero |

---

**Análisis completado**: 2025-12-29
**Conclusión**: Sistema necesita infraestructura de DB de test para alcanzar >85% de éxito en tests de integración
