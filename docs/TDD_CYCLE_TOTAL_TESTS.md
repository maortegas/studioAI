# Uso del Campo `tdd_cycle->>'total_tests'` en `coding_sessions`

## 📋 Descripción

El campo `total_tests` dentro del JSONB `tdd_cycle` almacena el **número total de tests** que deben ejecutarse en el ciclo TDD Red-Green-Refactor para una sesión de codificación.

## 🔧 Inicialización

El campo se inicializa cuando se crea el ciclo TDD, después de que la IA genera los tests:

```typescript
// En initializeTDDCycle() - codingSessionService.ts línea 944
total_tests: generatedTests.length,
```

**Ubicación:** `packages/backend/src/services/codingSessionService.ts:944`

**Ejemplo:**
- Si la IA genera 50 tests → `total_tests = 50`
- Si la IA genera 10 tests → `total_tests = 10`

## 📊 Usos del Campo

### 1. **Cálculo de Progreso (Progress)**

Se usa para calcular el porcentaje de progreso en diferentes fases:

#### Fase GREEN (Implementación):
```typescript
// Línea 1041
implementation_progress = Math.floor((tddCycle.test_index / tddCycle.total_tests) * 50)
// Ejemplo: test 5 de 50 → (5/50) * 50 = 5%
```

#### Fase REFACTOR:
```typescript
// Línea 1098
progress = Math.floor(50 + (tddCycle.test_index / tddCycle.total_tests) * 30)
// Ejemplo: test 5 de 50 → 50 + (5/50) * 30 = 53%
// Rango: 50-80% (50% base + hasta 30% adicional)
```

### 2. **Verificación de Completitud**

Se usa para determinar si todos los tests han sido completados:

```typescript
// Línea 1149
if (tddCycle.test_index >= tddCycle.total_tests) {
  // Todos los tests completados!
  // Marcar sesión como 'completed'
}
```

**Lógica:**
- `test_index` es 0-based (0, 1, 2, ..., total_tests-1)
- Cuando `test_index >= total_tests`, significa que se procesaron todos los tests
- Ejemplo: Si `total_tests = 50`, cuando `test_index = 50`, todos los tests están completos

### 3. **Logging y Mensajes Informativos**

Se usa para mostrar el progreso en logs y mensajes:

```typescript
// RED Phase - Línea 981
console.log(`[TDD-RED] Executing test ${tddCycle.test_index + 1}/${tddCycle.total_tests}`);

// GREEN Phase - Línea 1021
console.log(`[TDD-GREEN] Implementing code for test ${tddCycle.test_index + 1}/${tddCycle.total_tests}`);

// REFACTOR Phase - Línea 1078
console.log(`[TDD-REFACTOR] Refactoring code after test ${tddCycle.test_index + 1}/${tddCycle.total_tests}`);

// Advance - Línea 1182
console.log(`[TDD] Advanced to test ${tddCycle.test_index + 1}/${tddCycle.total_tests}`);
```

**Formato:** `Test X de Y` (ejemplo: "Test 7 de 50")

### 4. **Prompts para la IA**

Se incluye en los prompts para que la IA sepa el contexto:

```typescript
// RED Phase Prompt - Línea 1196
lines.push(`## Current Test (${tddCycle.test_index + 1}/${tddCycle.total_tests})\n\n`);

// GREEN Phase Prompt - Línea 1253
lines.push(`## Current Test (${tddCycle.test_index + 1}/${tddCycle.total_tests})\n\n`);

// REFACTOR Phase Prompt - Línea 1326
lines.push(`**Tests Completed:** ${tddCycle.test_index + 1}/${tddCycle.total_tests}\n`);
```

## 🔍 Consultas SQL

### Obtener total_tests de una sesión:

```sql
SELECT 
  id,
  status,
  tdd_cycle->>'total_tests' as total_tests,
  tdd_cycle->>'test_index' as current_test_index,
  tdd_cycle->>'tests_passed' as tests_passed
FROM coding_sessions
WHERE id = 'session-id';
```

### Calcular progreso:

```sql
SELECT 
  id,
  status,
  (tdd_cycle->>'test_index')::int as current_test,
  (tdd_cycle->>'total_tests')::int as total_tests,
  ROUND(
    ((tdd_cycle->>'test_index')::float / 
     NULLIF((tdd_cycle->>'total_tests')::int, 0)) * 100, 
    2
  ) as progress_percentage
FROM coding_sessions
WHERE tdd_cycle IS NOT NULL;
```

### Verificar si todos los tests están completos:

```sql
SELECT 
  id,
  status,
  (tdd_cycle->>'test_index')::int >= (tdd_cycle->>'total_tests')::int as all_tests_completed
FROM coding_sessions
WHERE tdd_cycle IS NOT NULL;
```

## 📈 Ejemplo de Flujo

```
Inicialización:
  total_tests = 50
  test_index = 0
  tests_passed = 0

Test 1:
  test_index = 0 → "Test 1 de 50"
  progress = (0/50) * 50 = 0%

Test 2:
  test_index = 1 → "Test 2 de 50"
  progress = (1/50) * 50 = 1%

...

Test 50:
  test_index = 49 → "Test 50 de 50"
  progress = (49/50) * 50 = 49%

Completado:
  test_index = 50
  test_index >= total_tests (50 >= 50) → TRUE
  status = 'completed'
  progress = 100%
```

## ⚠️ Notas Importantes

1. **Inmutabilidad:** `total_tests` NO se modifica después de la inicialización. Es un valor fijo que representa el total de tests generados.

2. **Relación con `all_tests`:** 
   - `total_tests` = número total
   - `all_tests` = array con los detalles de cada test
   - `total_tests === all_tests.length` (siempre debe ser verdadero)

3. **Validación:** Si `test_index >= total_tests`, el ciclo TDD está completo.

4. **División por cero:** En los cálculos de progreso, se debe validar que `total_tests > 0` para evitar división por cero.

## 🔗 Archivos Relacionados

- **Definición del tipo:** `packages/shared/src/types/coding-session.ts:25`
- **Inicialización:** `packages/backend/src/services/codingSessionService.ts:944`
- **Uso en cálculos:** `packages/backend/src/services/codingSessionService.ts:1041, 1098, 1149`
- **Uso en worker:** `packages/worker/src/worker.ts:923, 940, 972`

