# Flujo de Establecimiento de `total_tests`

## 📍 Ubicación Exacta

El valor de `total_tests` se establece **UNA SOLA VEZ** en:

**Archivo:** `packages/backend/src/services/codingSessionService.ts`  
**Línea:** `944`  
**Función:** `initializeTDDCycle()`

```typescript
total_tests: generatedTests.length,
```

## 🔄 Flujo Completo

### Paso 1: Generación de Tests por la IA
```
Usuario crea sesión con test_strategy='tdd'
  ↓
Se crea job de generación de tests (phase='test_generation')
  ↓
IA genera tests y devuelve output
```

**Ubicación:** `packages/backend/src/services/codingSessionService.ts:86-107`

### Paso 2: Worker Procesa el Job Completado
```
Worker detecta que el job de test_generation terminó
  ↓
Verifica que tdd_mode='strict'
  ↓
Llama a parseGeneratedTests(result.output)
```

**Ubicación:** `packages/worker/src/worker.ts:600-608`

### Paso 3: Parsing de Tests
```
parseGeneratedTests() extrae tests del output de la IA
  ↓
Retorna: Array<{name: string; code: string}>
  ↓
Ejemplo: [{name: "test1", code: "..."}, {name: "test2", code: "..."}, ...]
```

**Ubicación:** `packages/worker/src/worker.ts:4034-4126`

**Formats soportados:**
- JSON estructurado
- Jest/Mocha (`it()`, `test()`)
- Python pytest (`def test_*()`)
- Java JUnit (`@Test`)
- Describe blocks
- Fallback: todo el output como un solo test

### Paso 4: Inicialización del Ciclo TDD
```
Worker llama a codingSessionService.initializeTDDCycle(sessionId, parsedTests)
  ↓
initializeTDDCycle() crea el objeto TDDCycle
  ↓
total_tests = parsedTests.length  ← AQUÍ SE ESTABLECE
  ↓
Se guarda en la BD: UPDATE coding_sessions SET tdd_cycle = ...
```

**Ubicación:** `packages/backend/src/services/codingSessionService.ts:929-970`

## 📝 Código Completo

### 1. Worker detecta tests generados:
```typescript
// packages/worker/src/worker.ts:600-626
if (tddMode === 'strict') {
  // Parse generated tests from AI output
  const parsedTests = await parseGeneratedTests(result.output);
  
  if (parsedTests.length === 0) {
    // Error: no tests found
    return;
  }
  
  // Initialize TDD cycle
  await codingSessionService.initializeTDDCycle(codingSessionId, parsedTests);
}
```

### 2. initializeTDDCycle establece total_tests:
```typescript
// packages/backend/src/services/codingSessionService.ts:929-953
async initializeTDDCycle(
  sessionId: string, 
  generatedTests: Array<{name: string; code: string}>
): Promise<void> {
  if (generatedTests.length === 0) {
    throw new Error('No tests generated for TDD cycle');
  }

  const tddCycle: TDDCycle = {
    test_index: 0,
    phase: 'red',
    current_test: generatedTests[0].code,
    current_test_name: generatedTests[0].name,
    tests_passed: 0,
    total_tests: generatedTests.length,  // ← AQUÍ SE ESTABLECE
    all_tests: generatedTests.map(t => ({
      name: t.name,
      code: t.code,
      status: 'pending' as const,
      attempts: 0
    })),
    refactor_count: 0,
    stuck_count: 0
  };

  // Guardar en BD
  await pool.query(
    `UPDATE coding_sessions SET 
     status = $1, 
     tdd_cycle = $2::jsonb,
     test_progress = $3
     WHERE id = $4`,
    ['tests_generated', JSON.stringify(tddCycle), 50, sessionId]
  );
}
```

## 🔍 Ejemplo Práctico

### Escenario: IA genera 50 tests

1. **IA genera output:**
   ```javascript
   // Test 1: should initialize with database pool
   it('should initialize with database pool', () => { ... });
   
   // Test 2: should use environment variables
   it('should use environment variables', () => { ... });
   
   // ... (48 tests más)
   ```

2. **parseGeneratedTests() extrae:**
   ```typescript
   [
     {name: "should initialize with database pool", code: "it('should...", ...},
     {name: "should use environment variables", code: "it('should...", ...},
     // ... (48 tests más)
   ]
   // Total: 50 tests
   ```

3. **initializeTDDCycle() establece:**
   ```typescript
   total_tests: 50  // ← generatedTests.length = 50
   ```

4. **Se guarda en BD:**
   ```sql
   UPDATE coding_sessions 
   SET tdd_cycle = '{
     "test_index": 0,
     "phase": "red",
     "total_tests": 50,  ← AQUÍ EN LA BD
     "all_tests": [...]
   }'::jsonb
   WHERE id = 'session-id';
   ```

## ⚠️ Puntos Importantes

1. **Se establece UNA SOLA VEZ:** Después de la inicialización, `total_tests` **NO se modifica**.

2. **Valor inmutable:** El valor permanece constante durante todo el ciclo TDD.

3. **Relación con all_tests:** 
   - `total_tests` = número total
   - `all_tests.length` = número de elementos en el array
   - **Siempre deben ser iguales:** `total_tests === all_tests.length`

4. **Si no hay tests:** Si `generatedTests.length === 0`, se lanza un error y la sesión se marca como `failed`.

5. **Fallback:** Si `parseGeneratedTests()` no puede extraer tests estructurados, devuelve un array con un solo test que contiene todo el output.

## 🔗 Archivos Relacionados

| Archivo | Línea | Función |
|---------|-------|---------|
| `packages/worker/src/worker.ts` | 608 | `parseGeneratedTests()` - Extrae tests del output |
| `packages/worker/src/worker.ts` | 626 | Llama a `initializeTDDCycle()` |
| `packages/backend/src/services/codingSessionService.ts` | 929 | `initializeTDDCycle()` - Establece `total_tests` |
| `packages/backend/src/services/codingSessionService.ts` | 944 | **`total_tests: generatedTests.length`** ← AQUÍ |

## 📊 Visualización del Flujo

```
┌─────────────────────────────────────────────────────────┐
│ 1. Usuario crea sesión con test_strategy='tdd'        │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Se crea job de generación de tests                  │
│    phase='test_generation', tdd_mode='strict'         │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 3. IA genera tests y devuelve output                   │
│    Ejemplo: 50 tests en formato Jest/Mocha            │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Worker procesa job completado                       │
│    Detecta tdd_mode='strict'                          │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 5. parseGeneratedTests(result.output)                  │
│    Extrae: [{name, code}, {name, code}, ...]          │
│    Retorna: Array con 50 tests                         │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 6. initializeTDDCycle(sessionId, parsedTests)          │
│    total_tests = parsedTests.length  ← AQUÍ            │
│    total_tests = 50                                    │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 7. Se guarda en BD:                                    │
│    UPDATE coding_sessions SET tdd_cycle = {...}        │
│    tdd_cycle.total_tests = 50                          │
└─────────────────────────────────────────────────────────┘
```

## ✅ Resumen

**`total_tests` se establece en:**
- **Archivo:** `packages/backend/src/services/codingSessionService.ts`
- **Línea:** `944`
- **Función:** `initializeTDDCycle()`
- **Valor:** `generatedTests.length` (número de tests parseados del output de la IA)
- **Cuándo:** Una sola vez, cuando se inicializa el ciclo TDD después de generar tests
- **Quién lo llama:** El worker (`packages/worker/src/worker.ts:626`)

