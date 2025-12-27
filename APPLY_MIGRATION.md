# 🔄 Aplicar Migración 012: TDD Cycle Support

## 📋 Instrucciones para Aplicar la Migración

### Opción 1: Usando el Script de Setup (Recomendado)

```bash
cd /Users/mortegas/Documents/StudioIA
./scripts/setup-db.sh
```

Este script:
- Inicia PostgreSQL en Docker
- Ejecuta todas las migraciones pendientes (incluyendo la 012)

### Opción 2: Ejecutar Migración Manualmente

```bash
cd /Users/mortegas/Documents/StudioIA/database
DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=devflow_studio npm run migrate
```

### Opción 3: Desde psql (PostgreSQL CLI)

```bash
# Conectar a la base de datos
psql -h localhost -U postgres -d devflow_studio

# Luego ejecutar la migración
\i database/migrations/012_add_tdd_cycle.sql
```

### Opción 4: Verificar que la Migración se Aplicó

```bash
# Conectar a PostgreSQL
psql -h localhost -U postgres -d devflow_studio

# Verificar que la columna existe
\d coding_sessions

# Verificar que el constraint incluye los nuevos status
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'coding_sessions'::regclass 
AND conname = 'coding_sessions_status_check';

# Verificar que el índice existe
\di idx_coding_sessions_tdd_cycle
```

## ✅ Verificación Post-Migración

Después de aplicar la migración, deberías ver:

1. **Columna `tdd_cycle`** en la tabla `coding_sessions`
2. **Status TDD** en el constraint: `'tdd_red'`, `'tdd_green'`, `'tdd_refactor'`
3. **Índice GIN** `idx_coding_sessions_tdd_cycle` creado
4. **Registro en `schema_migrations`** con versión `012_add_tdd_cycle`

## 🔍 Consultas de Verificación

```sql
-- Ver todas las migraciones aplicadas
SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC;

-- Ver estructura de coding_sessions
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'coding_sessions' 
AND column_name = 'tdd_cycle';

-- Ver constraint de status
SELECT pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'coding_sessions_status_check';
```

## ⚠️ Notas Importantes

- La migración es **idempotente** (usa `IF NOT EXISTS` y `DROP CONSTRAINT IF EXISTS`)
- Puede ejecutarse múltiples veces sin problemas
- No afecta datos existentes (solo agrega columnas y constraints)
- El campo `tdd_cycle` es opcional (nullable) para mantener compatibilidad


