# 🧪 Guía para Verificar que el TDD Funciona

## 📋 Resumen del Flujo TDD

El sistema implementa un ciclo **Red-Green-Refactor** estricto:

1. **Generación de Tests** (`generating_tests` → `tests_generated`)
2. **Inicialización del Ciclo TDD** (si `tdd_mode='strict'`)
3. **Fase RED** (`tdd_red`): Ejecutar test y verificar que falla
4. **Fase GREEN** (`tdd_green`): Implementar código mínimo para pasar el test
5. **Fase REFACTOR** (`tdd_refactor`): Mejorar código manteniendo tests pasando
6. **Repetir** para cada test hasta completar todos

---

## 🔍 Método 1: Verificar en la Base de Datos

### Paso 1: Verificar que la migración está aplicada

```bash
cd /Users/mortegas/Documents/StudioIA
psql -h localhost -U postgres -d devflow_studio -c "
SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'coding_sessions' 
AND column_name = 'tdd_cycle';
"
```

**✅ Deberías ver:** `tdd_cycle | jsonb`

### Paso 2: Crear una sesión de codificación con TDD

```bash
# Obtener un project_id y story_id existentes
psql -h localhost -U postgres -d devflow_studio -c "
SELECT id, name FROM projects LIMIT 1;
"

psql -h localhost -U postgres -d devflow_studio -c "
SELECT id, title, type FROM tasks WHERE type = 'story' LIMIT 1;
"
```

### Paso 3: Crear sesión vía API

```bash
curl -X POST http://localhost:3001/api/coding-sessions/create \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "TU_PROJECT_ID",
    "story_id": "TU_STORY_ID",
    "programmer_type": "backend",
    "test_strategy": "tdd"
  }'
```

### Paso 4: Verificar que se creó el job de generación de tests

```bash
# Ver el job de generación de tests
psql -h localhost -U postgres -d devflow_studio -c "
SELECT 
  aj.id,
  aj.status,
  aj.args->>'phase' as phase,
  aj.args->>'test_strategy' as test_strategy,
  aj.args->>'tdd_mode' as tdd_mode,
  cs.id as session_id,
  cs.status as session_status
FROM ai_jobs aj
JOIN coding_sessions cs ON cs.test_generation_job_id = aj.id
WHERE cs.id = 'TU_SESSION_ID'
ORDER BY aj.created_at DESC;
"
```

### Paso 5: Verificar modo TDD estricto

**✅ AUTOMÁTICO:** El `tdd_mode='strict'` se activa automáticamente cuando `test_strategy: 'tdd'`.

```sql
-- Verificar que el modo estricto está activado
SELECT 
  aj.id,
  aj.args->>'tdd_mode' as tdd_mode,
  aj.args->>'test_strategy' as test_strategy
FROM ai_jobs aj
JOIN coding_sessions cs ON cs.test_generation_job_id = aj.id
WHERE cs.id = 'TU_SESSION_ID';
```

**✅ Deberías ver:** `tdd_mode = 'strict'`

### Paso 6: Monitorear el progreso del TDD

```sql
-- Ver el estado del ciclo TDD
SELECT 
  id,
  status,
  tdd_cycle->>'phase' as current_phase,
  tdd_cycle->>'test_index' as current_test_index,
  tdd_cycle->>'total_tests' as total_tests,
  tdd_cycle->>'tests_passed' as tests_passed,
  tdd_cycle->'all_tests' as all_tests,
  updated_at
FROM coding_sessions
WHERE id = 'TU_SESSION_ID';
```

**✅ Deberías ver:**
- `status` cambiando entre: `generating_tests` → `tests_generated` → `tdd_red` → `tdd_green` → `tdd_refactor` → ...
- `tdd_cycle.phase` cambiando: `red` → `green` → `refactor`
- `tdd_cycle.test_index` incrementando
- `tdd_cycle.all_tests` con la lista de tests

---

## 🔍 Método 2: Verificar en los Logs del Worker

### Paso 1: Ver logs del worker

```bash
# Si el worker está corriendo, ver los logs
cd /Users/mortegas/Documents/StudioIA/packages/worker
npm run dev

# O si está en producción, ver logs del proceso
tail -f logs/worker.log
```

### Paso 2: Buscar mensajes clave

Busca estos mensajes en los logs:

```
✅ [Worker] Initializing strict TDD cycle for session {sessionId}
✅ [Worker] TDD cycle initialized with {N} tests. Starting RED phase.
✅ [Worker] Processing TDD phase: tdd_red for session {sessionId}
✅ [Worker] RED phase completed for test {X}/{total}
✅ [Worker] Processing TDD phase: tdd_green for session {sessionId}
✅ [Worker] GREEN phase completed for test {X}/{total}
✅ [Worker] Processing TDD phase: tdd_refactor for session {sessionId}
✅ [Worker] REFACTOR phase completed for test {X}/{total}
✅ [Worker] All TDD tests completed for session {sessionId}
```

---

## 🔍 Método 3: Verificar vía API REST

### Paso 1: Obtener estado de la sesión

```bash
curl http://localhost:3001/api/coding-sessions/TU_SESSION_ID
```

**Respuesta esperada:**
```json
{
  "id": "...",
  "status": "tdd_green",
  "tdd_cycle": {
    "test_index": 2,
    "phase": "green",
    "current_test": "describe('UserService', () => { ... })",
    "current_test_name": "should create a user",
    "tests_passed": 1,
    "total_tests": 5,
    "all_tests": [
      {
        "name": "should create a user",
        "code": "...",
        "status": "green",
        "attempts": 1
      },
      {
        "name": "should validate email",
        "code": "...",
        "status": "pending",
        "attempts": 0
      }
    ],
    "refactor_count": 0,
    "stuck_count": 0
  },
  ...
}
```

### Paso 2: Monitorear cambios de estado (SSE)

```bash
# Conectar al stream de eventos
curl -N http://localhost:3001/api/coding-sessions/stream/TU_SESSION_ID
```

**Eventos esperados:**
```json
{"type":"connected","sessionId":"..."}
{"type":"progress","payload":{"progress":10},"timestamp":"..."}
{"type":"tests_generated","payload":{"tests_output":"..."},"timestamp":"..."}
{"type":"phase_change","payload":{"phase":"tdd_red"},"timestamp":"..."}
{"type":"phase_change","payload":{"phase":"tdd_green"},"timestamp":"..."}
{"type":"phase_change","payload":{"phase":"tdd_refactor"},"timestamp":"..."}
```

---

## 🔍 Método 4: Verificar en el Frontend

### Paso 1: Abrir el dashboard de implementación

1. Navega a: `http://localhost:3000/projects/{projectId}/implementation`
2. Busca la sesión de codificación creada
3. Verifica que el estado muestre las fases TDD

### Paso 2: Ver detalles de la sesión

1. Haz clic en la sesión
2. Deberías ver:
   - Estado actual: `tdd_red`, `tdd_green`, o `tdd_refactor`
   - Progreso del ciclo TDD
   - Lista de tests con su estado

---

## 🐛 Troubleshooting

### Problema: El ciclo TDD no se inicializa

**Causa:** `tdd_mode='strict'` no está en los args del job (debería activarse automáticamente).

**Verificación:**
```sql
-- Verificar si tdd_mode está presente
SELECT 
  aj.id,
  aj.args->>'tdd_mode' as tdd_mode,
  aj.args->>'test_strategy' as test_strategy
FROM ai_jobs aj
JOIN coding_sessions cs ON cs.test_generation_job_id = aj.id
WHERE cs.id = 'TU_SESSION_ID';
```

**Solución (si no está activado automáticamente):**
```sql
-- Activar manualmente si es necesario
UPDATE ai_jobs 
SET args = args || '{"tdd_mode": "strict"}'::jsonb
WHERE id = 'TU_TEST_GENERATION_JOB_ID';
```

**Nota:** Si esto ocurre frecuentemente, revisa el código en `codingSessionService.ts` línea 106.

### Problema: El estado se queda en `tests_generated`

**Causa:** El worker no está procesando el job o hay un error.

**Solución:**
1. Verificar que el worker está corriendo
2. Ver logs del worker para errores
3. Verificar que el job tiene `status = 'pending'` o `status = 'running'`

### Problema: El ciclo TDD no avanza entre fases

**Causa:** Los tests no están pasando/fallando como se espera.

**Solución:**
1. Verificar los logs del worker para ver qué está detectando
2. Verificar que el output del test contiene "pass" o "fail"
3. Revisar `stuck_count` en `tdd_cycle` (si es > 3, se salta al siguiente test)

### Problema: No se ve `tdd_cycle` en la respuesta

**Causa:** La migración no se aplicó o el campo no se está serializando.

**Solución:**
```sql
-- Verificar que la columna existe
\d coding_sessions

-- Verificar que hay datos
SELECT id, tdd_cycle FROM coding_sessions WHERE id = 'TU_SESSION_ID';
```

---

## ✅ Checklist de Verificación

- [ ] Migración `012_add_tdd_cycle` aplicada
- [ ] Columna `tdd_cycle` existe en `coding_sessions`
- [ ] Índice `idx_coding_sessions_tdd_cycle` existe
- [ ] Se puede crear una sesión con `test_strategy: 'tdd'`
- [ ] El job de generación de tests se crea correctamente
- [ ] `tdd_mode: 'strict'` está en los args del job
- [ ] El worker inicializa el ciclo TDD después de generar tests
- [ ] El estado cambia a `tdd_red` después de inicializar
- [ ] El estado avanza: `tdd_red` → `tdd_green` → `tdd_refactor`
- [ ] El `test_index` incrementa después de cada ciclo completo
- [ ] Los tests se marcan como `red`, `green`, `refactored` en `all_tests`
- [ ] La sesión se completa cuando todos los tests están `refactored`

---

## 🚀 Próximos Pasos para Mejorar

1. ✅ **Automatizar `tdd_mode='strict'`**: ✅ COMPLETADO - Se activa automáticamente cuando `test_strategy: 'tdd'`.

2. **UI para TDD**: Mostrar el progreso del ciclo TDD en el frontend con:
   - Indicador visual de la fase actual (RED/GREEN/REFACTOR)
   - Lista de tests con su estado
   - Progreso: "Test 3 de 5"
   - Botón para ver el test actual

3. **Logs estructurados**: Mejorar los logs para incluir más contexto del ciclo TDD.

4. **Métricas**: Agregar métricas de tiempo por fase y por test.

---

## 📝 Notas Importantes

- **Modo TDD Estricto**: Se activa automáticamente cuando se crea una sesión con `test_strategy: 'tdd'`. El sistema agrega `tdd_mode: 'strict'` a los args del job de generación de tests.

- **Compatibilidad**: El sistema mantiene compatibilidad con el modo TDD legacy (sin ciclo estricto).

- **Retry Logic**: Si un test se queda "stuck" en GREEN (más de 3 intentos), se salta al siguiente test automáticamente.

- **Validación**: El worker valida que:
  - RED: El test debe fallar (busca "fail" en el output)
  - GREEN: El test debe pasar (busca "pass" en el output)
  - REFACTOR: Todos los tests deben seguir pasando

---

**¿Necesitas ayuda?** Revisa los logs del worker y la base de datos para diagnosticar problemas específicos.

