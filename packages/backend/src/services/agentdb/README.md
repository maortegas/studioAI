# AgentDB Service

Servicio para gestionar bases de datos SQLite locales para contexto persistente de sesiones TDD.

## Arquitectura

### Base de Datos por Proyecto

**Formato actual**: Una base de datos SQLite por proyecto, compartida por todas las sesiones.

```
{projectPath}/.agentdb/{projectName}.db
```

**Ejemplo**:
```
/Users/mortegas/Documents/sistemas/projects/myapp/.agentdb/myapp.db
```

### Ventajas del Enfoque por Proyecto

1. **Queries históricas simples**: Todas las sesiones en una sola DB
2. **Mejor performance**: No hay necesidad de abrir múltiples DBs para contexto histórico
3. **Un solo archivo por proyecto**: Más fácil de administrar
4. **Contexto compartido**: Todas las sesiones pueden aprender de sesiones previas

### Schema de Tablas

Todas las tablas usan `session_id` como clave para distinguir entre sesiones:

#### `tests`
- Almacena tests generados para cada sesión TDD
- Campos: `id`, `session_id`, `story_id`, `name`, `code`, `status`, `created_at`

#### `code`
- Guarda implementaciones de código
- Campos: `id`, `session_id`, `story_id`, `file_path`, `content`, `tests_passing`, `created_at`, `updated_at`

#### `decisions`
- Registra decisiones de implementación del AI
- Campos: `id`, `session_id`, `story_id`, `action`, `reason`, `code_snippet`, `test_related`, `timestamp`

#### `history`
- Historial de acciones por fase (RED, GREEN, REFACTOR)
- Campos: `id`, `session_id`, `phase`, `action`, `result`, `files_modified`, `timestamp`

#### `traceability`
- Cadena de trazabilidad completa desde PRD hasta código
- Campos: `session_id` (PK), `prd_id`, `story_id`, `design_id`, `rfc_id`, `epic_id`, `breakdown_tasks`, `created_at`, `updated_at`

#### `tdd_state`
- Estado actual de la sesión TDD
- Campos: `session_id` (PK), `state_json`, `updated_at`

#### `tdd_rules`
- Reglas TDD para la sesión (generadas por AI)
- Campos: `session_id` (PK), `rules_json`, `created_at`, `updated_at`

### Índices

Todas las tablas tienen índices en `session_id` para queries eficientes:
- `idx_tests_session_id`
- `idx_code_session_id`
- `idx_decisions_session_id`
- `idx_history_session_id`

## Persistencia

AgentDB usa `sql.js` (SQLite compilado a WebAssembly), que requiere llamadas explícitas a `save()` para persistir datos:

```typescript
// Después de cada operación de escritura
if (typeof sqliteDb.save === 'function') {
  sqliteDb.save(); // Persiste a disco
}
```

Esto ocurre en:
1. Después del test write inicial
2. Después de cada `executeStatement()` (INSERT/UPDATE/DELETE)
3. En el método `close()` antes de cerrar la conexión

## Uso

```typescript
import { AgentDBService } from './services/agentdb/AgentDBService';

const agentdbService = new AgentDBService();

// Obtener instancia (crea DB si no existe)
const db = await agentdbService.getInstance(projectPath, sessionId);

// Ejecutar query
const results = await agentdbService.executeQuery(db, 
  'SELECT * FROM tests WHERE session_id = ?', 
  [sessionId]
);

// Ejecutar statement
await agentdbService.executeStatement(db,
  'INSERT INTO tests (session_id, name, code, status) VALUES (?, ?, ?, ?)',
  [sessionId, 'test_name', 'test code', 'pending']
);

// La DB se guarda automáticamente después de cada statement
```

## Managers Especializados

### AgentDBContextManager
Gestiona el contexto TDD (tests, código previo, decisiones)

### AgentDBStateManager
Gestiona el estado de la sesión TDD (fase actual, progreso)

### AgentDBRulesManager
Gestiona las reglas TDD generadas por AI

### AgentDBTraceabilityStore
Gestiona la cadena de trazabilidad completa

## Migración

Si tienes bases de datos antiguas por sesión (`{sessionId}.db`), ejecuta:

```bash
node scripts/migrate-agentdb-to-project.js
```

Esto moverá los archivos antiguos a `backup-sessions/` y el nuevo formato se creará automáticamente.

## Limpieza de Sesiones Antiguas

Para mantener el tamaño de la DB bajo control, puedes implementar una limpieza periódica:

```typescript
// Eliminar sesiones más antiguas que 30 días
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - 30);

await agentdbService.executeStatement(db,
  'DELETE FROM tests WHERE session_id IN (SELECT DISTINCT session_id FROM history WHERE timestamp < ?)',
  [cutoffDate.toISOString()]
);

// Repetir para otras tablas...
```

## Troubleshooting

### Los archivos .db no se crean

Verifica que `save()` se está llamando después de las operaciones de escritura. Revisa los logs:
- `✅ Database saved to disk: {path}`

### Performance lenta con muchas sesiones

Considera:
1. Agregar más índices específicos para tus queries
2. Implementar limpieza de sesiones antiguas
3. Usar VACUUM periódicamente para optimizar el archivo

```sql
VACUUM;
```

### Corrupción de DB

Si la DB se corrompe, los backups de sesiones antiguas están en `backup-sessions/`. Puedes:
1. Restaurar desde backup
2. O borrar la DB corrupta y dejar que se cree una nueva

