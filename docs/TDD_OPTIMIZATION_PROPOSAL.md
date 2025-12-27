# Propuesta de Optimización del Ciclo TDD

## 🚨 Problema Actual

El flujo TDD actual procesa **cada test individualmente**, creando:
- **3 jobs por test** (RED, GREEN, REFACTOR)
- Para **50 tests** = **150 jobs totales**
- Esto es ineficiente y puede causar:
  - Rate limiting de la API
  - Sobrecarga del sistema
  - Tiempos de ejecución muy largos
  - Costos elevados

## 💡 Solución Propuesta: Batch Processing

### Opción 1: Procesar Tests en Batches (Recomendado)

**Agrupar tests en batches de 5-10 tests por fase:**

```
50 tests → 5 batches de 10 tests cada uno
  ↓
Batch 1: Tests 1-10 → RED → GREEN → REFACTOR (3 jobs)
Batch 2: Tests 11-20 → RED → GREEN → REFACTOR (3 jobs)
...
Total: 5 batches × 3 fases = 15 jobs (vs 150 actuales)
```

**Reducción:** De 150 jobs a 15 jobs (90% reducción)

### Opción 2: Procesar Todos los Tests Juntos

**Un solo ciclo para todos los tests:**

```
50 tests → 1 ciclo completo
  ↓
RED: Ejecutar todos los tests (1 job)
GREEN: Implementar código para todos (1 job)
REFACTOR: Refactorizar todo (1 job)
Total: 3 jobs
```

**Reducción:** De 150 jobs a 3 jobs (98% reducción)

**Desventaja:** Más complejo de manejar errores individuales

### Opción 3: Híbrido - Batches con Fallback Individual

**Procesar en batches, pero si falla, procesar individualmente:**

```
50 tests → 5 batches de 10
  ↓
Si batch falla → procesar tests del batch individualmente
```

## 🎯 Implementación Recomendada: Opción 1 (Batches)

### Cambios Necesarios

1. **Agregar configuración de batch size:**
```typescript
const TDD_BATCH_SIZE = 10; // Tests por batch
```

2. **Modificar `initializeTDDCycle` para crear batches:**
```typescript
async initializeTDDCycle(
  sessionId: string, 
  generatedTests: Array<{name: string; code: string}>
): Promise<void> {
  const batchSize = 10;
  const batches: Array<Array<{name: string; code: string}>> = [];
  
  // Dividir tests en batches
  for (let i = 0; i < generatedTests.length; i += batchSize) {
    batches.push(generatedTests.slice(i, i + batchSize));
  }
  
  const tddCycle: TDDCycle = {
    test_index: 0,
    phase: 'red',
    current_batch: 0,
    total_batches: batches.length,
    total_tests: generatedTests.length,
    batches: batches, // Nuevo campo
    // ...
  };
}
```

3. **Modificar fases para procesar batches:**
```typescript
async executeTestRED(sessionId: string, tddCycle: TDDCycle): Promise<void> {
  const currentBatch = tddCycle.batches[tddCycle.current_batch];
  const batchTests = currentBatch.map(t => t.code).join('\n\n');
  
  // Prompt para ejecutar todos los tests del batch
  const redPrompt = `Execute these ${currentBatch.length} tests and verify they all FAIL:
${batchTests}`;
  
  // Crear 1 job para todo el batch
  // ...
}
```

4. **Actualizar lógica de avance:**
```typescript
async advanceToNextBatch(sessionId: string): Promise<void> {
  tddCycle.current_batch++;
  
  if (tddCycle.current_batch >= tddCycle.total_batches) {
    // Todos los batches completados
    // Marcar como completed
  } else {
    // Continuar con siguiente batch
    await this.executeTestRED(sessionId, tddCycle);
  }
}
```

## 📊 Comparación

| Métrica | Actual | Opción 1 (Batches) | Opción 2 (Todo junto) |
|---------|--------|---------------------|------------------------|
| Jobs totales | 150 | 15 | 3 |
| Reducción | - | 90% | 98% |
| Manejo de errores | Individual | Por batch | Complejo |
| Complejidad | Media | Media | Alta |
| Tiempo estimado | ~150h | ~15h | ~3h |

## 🔧 Implementación Paso a Paso

### Paso 1: Actualizar Interface TDDCycle

```typescript
interface TDDCycle {
  test_index: number;
  current_batch: number;        // NUEVO
  total_batches: number;         // NUEVO
  phase: 'red' | 'green' | 'refactor';
  current_test: string;
  current_test_name: string;
  tests_passed: number;
  total_tests: number;
  batches: Array<Array<{name: string; code: string}>>; // NUEVO
  all_tests: Array<{...}>;
  refactor_count: number;
  stuck_count: number;
}
```

### Paso 2: Modificar initializeTDDCycle

```typescript
async initializeTDDCycle(
  sessionId: string, 
  generatedTests: Array<{name: string; code: string}>
): Promise<void> {
  const BATCH_SIZE = 10;
  const batches: Array<Array<{name: string; code: string}>> = [];
  
  // Crear batches
  for (let i = 0; i < generatedTests.length; i += BATCH_SIZE) {
    batches.push(generatedTests.slice(i, i + BATCH_SIZE));
  }
  
  const tddCycle: TDDCycle = {
    test_index: 0,
    current_batch: 0,
    total_batches: batches.length,
    phase: 'red',
    current_test: batches[0].map(t => t.code).join('\n\n'),
    current_test_name: `Batch 1 (${batches[0].length} tests)`,
    tests_passed: 0,
    total_tests: generatedTests.length,
    batches: batches,
    all_tests: generatedTests.map(t => ({
      name: t.name,
      code: t.code,
      status: 'pending' as const,
      attempts: 0
    })),
    refactor_count: 0,
    stuck_count: 0
  };
  
  // Guardar y continuar...
}
```

### Paso 3: Modificar Prompts para Batches

Los prompts deben indicar que se están procesando múltiples tests a la vez.

## ✅ Ventajas de Batch Processing

1. **Reducción masiva de jobs:** 90% menos jobs
2. **Mejor uso de recursos:** Menos overhead
3. **Más rápido:** Menos latencia entre jobs
4. **Manejo de errores:** Aún se puede identificar qué batch falló
5. **Escalable:** Fácil ajustar batch size según necesidades

## ⚠️ Consideraciones

1. **Batch size:** Debe ser configurable (5-10 tests es un buen rango)
2. **Errores:** Si un batch falla, se puede procesar individualmente
3. **Progreso:** Mostrar "Batch X de Y" en lugar de "Test X de Y"
4. **Logs:** Incluir información del batch en los logs

## 🚀 Próximos Pasos

1. Implementar batch processing en `initializeTDDCycle`
2. Modificar `executeTestRED`, `executeTestGREEN`, `executeRefactor` para batches
3. Actualizar `advanceToNextTest` → `advanceToNextBatch`
4. Actualizar prompts para indicar procesamiento por batches
5. Probar con un caso real

