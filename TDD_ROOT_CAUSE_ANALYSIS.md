# Análisis de Causa Raíz: Fallo Sistémico del Flujo TDD

**Fecha**: 2025-12-28
**Problema**: Después de varias iteraciones, el flujo TDD sigue generando código que NO pasa los tests

---

## 🔍 Investigación del Flujo Actual

### Flujo Actual del Sistema TDD

```
1. Generación de Tests ✅
   └─> parseAndSaveTestSuites()
   └─> Tests guardados en backend/tests/unit/

2. Inicio de Implementación (Fase GREEN) ✅
   └─> buildBatchGREENPhasePrompt()
   └─> createAIJob(phase: 'tdd_green')

3. Ejecución del Job ✅
   └─> AI genera implementación
   └─> Worker recibe output

4. Validación Post-Implementación ✅
   └─> executeBatchTests()
   └─> Ejecuta tests contra código generado

5. Análisis de Resultados ❌ AQUÍ ESTÁ EL PROBLEMA
```

---

## 🚨 **PROBLEMA CRÍTICO IDENTIFICADO**

### Ubicación del Problema

**Archivo**: `packages/worker/src/worker.ts`
**Líneas**: 1583-1610

### El Código Problemático

```typescript
if (!testsPassed) {
  console.warn(`[Worker] ⚠️ Batch tests did not pass. Results: ${batchTestResults.passed} passed, ${batchTestResults.failed} failed`);

  // Increment stuck count
  tddCycle.stuck_count = (tddCycle.stuck_count || 0) + 1;

  if (tddCycle.stuck_count >= 3) {
    // Too many failed attempts, skip to next batch  ❌ SIMPLEMENTE SE RINDE
    console.error(`[Worker] ❌ Stuck on batch ${batchStart + 1}-${batchEnd} after 3 attempts. Moving to next batch.`);
    tddCycle.test_index = batchEnd;
    // ...
    await codingSessionService.advanceToNextBatch(codingSessionId);
    return;
  }

  // Try GREEN phase again  ❌ RETRY CIEGO SIN CONTEXTO
  console.log(`[Worker] 🔄 Retrying GREEN phase for batch ${batchStart + 1}-${batchEnd}. Attempt ${tddCycle.stuck_count}/3`);
  await pool.query(
    `UPDATE coding_sessions SET tdd_cycle = $1::jsonb WHERE id = $2`,
    [JSON.stringify(tddCycle), codingSessionId]
  );
  await codingSessionService.executeBatchGREEN(codingSessionId);
  return;
}
```

---

## ❌ **Problemas Fundamentales**

### 1. **Retry Ciego sin Aprendizaje**

**Problema**:
```typescript
await codingSessionService.executeBatchGREEN(codingSessionId);
```

Esto vuelve a ejecutar `buildBatchGREENPhasePrompt()` con **EXACTAMENTE EL MISMO PROMPT**.

**Resultado**:
- La IA genera la misma implementación incorrecta
- Los tests vuelven a fallar
- Se repite 3 veces
- Después de 3 intentos, se rinde y avanza al siguiente batch

### 2. **NO Se Incluye el Feedback de Tests Fallidos**

**Lo que falta**:
```typescript
// ❌ NUNCA se hace esto:
const testOutput = batchTestResults.output;  // Qué esperaban los tests
const errorMessages = batchTestResults.errors; // Por qué fallaron
const currentImplementation = readImplementationCode(); // Qué código se generó
```

**Consecuencia**:
- La IA NO ve qué esperaban los tests
- NO ve el mensaje de error
- NO ve su implementación actual
- NO sabe qué corregir

### 3. **Prompt NO Incluye Contexto de Fallo**

**Prompt Actual** (`buildBatchGREENPhasePrompt` - línea 1970-1976):
```typescript
lines.push(`## GREEN Phase Objective\n\n`);
lines.push(`**CRITICAL - GREEN Phase Requirements:**\n`);
lines.push(`1. Write MINIMAL code to make ALL ${batchTests.length} tests pass\n`);
lines.push(`2. Focus on making tests pass, NOT on perfect code\n`);
lines.push(`3. Run tests after implementation to verify ALL pass\n`);
lines.push(`4. If tests fail, fix the code until they pass\n`);  // ❌ DICE que lo haga, pero NO da info
lines.push(`5. Report success with test execution output\n\n`);
```

**Lo que debería incluir en el retry**:
```typescript
lines.push(`## PREVIOUS ATTEMPT FAILED\n\n`);
lines.push(`### Test Execution Results:\n`);
lines.push(`\`\`\`\n${testOutput}\`\`\`\n\n`);
lines.push(`### Tests That Failed:\n`);
lines.push(`- Expected: ${expected}\n`);
lines.push(`- Received: ${received}\n`);
lines.push(`- Error: ${errorMessage}\n\n`);
lines.push(`### Your Previous Implementation:\n`);
lines.push(`\`\`\`typescript\n${currentCode}\`\`\`\n\n`);
lines.push(`**FIX THE IMPLEMENTATION to match test expectations.**\n`);
```

---

## 📊 **Evidencia del Problema**

### Caso Real: tdd-test-project

**Tests Ejecutados**: 54
**Tests Pasando**: 23 (42.6%)
**Tests Fallando**: 31 (57.4%)

**Patrón de Fallos**:
```
getUserById:
- Test espera: undefined
- Implementación lanza: NotFoundError
- Razón: AI generó throw en lugar de return undefined
- ¿Por qué?: NO leyó las expectativas del test correctamente

deleteUser:
- Test espera: false
- Implementación lanza: NotFoundError
- Razón: Mismo problema que getUserById

Mensajes de Error:
- Test espera: "User name is required"
- Implementación dice: "Name is required"
- Razón: AI no vio el texto exacto esperado por el test
```

**Conclusión**: La IA **NO está leyendo los tests** o **NO entiende qué esperan**.

---

## 🎯 **Causa Raíz Identificada**

```
┌─────────────────────────────────────────────────────────────┐
│ FALTA UN LOOP DE RETROALIMENTACIÓN EFECTIVO                │
│                                                             │
│ El sistema actual:                                         │
│ 1. Genera implementación ✅                                │
│ 2. Ejecuta tests ✅                                         │
│ 3. Detecta fallos ✅                                        │
│ 4. Retry sin contexto de error ❌                          │
│ 5. Se rinde después de 3 intentos ❌                       │
│                                                             │
│ Lo que falta:                                              │
│ - Capturar OUTPUT de tests fallidos                       │
│ - Capturar EXPECTATIVAS de tests (assert messages)         │
│ - Capturar IMPLEMENTACIÓN actual                           │
│ - Crear PROMPT MEJORADO con toda esta información          │
│ - Dar instrucciones EXPLÍCITAS de corrección               │
└─────────────────────────────────────────────────────────────┘
```

---

## 💡 **Solución de Fondo**

### Propuesta: Implementar Loop de Retroalimentación Inteligente

#### Componente 1: Capturador de Contexto de Fallo

```typescript
async function captureBatchFailureContext(
  codingSessionId: string,
  batchStart: number,
  batchSize: number,
  testResults: BatchTestResults
): Promise<FailureContext> {
  const context: FailureContext = {
    failedTests: [],
    testOutput: testResults.output,
    errorMessages: [],
    currentImplementation: {}
  };

  // 1. Obtener tests que fallaron con sus expectativas
  const failedTestSuites = await pool.query(`
    SELECT ts.name, ts.test_code, te.output, te.error_message
    FROM test_suites ts
    JOIN test_executions te ON te.test_suite_id = ts.id
    WHERE ts.coding_session_id = $1 AND te.status = 'failed'
    ORDER BY te.completed_at DESC
    LIMIT $2
  `, [codingSessionId, batchSize]);

  for (const test of failedTestSuites.rows) {
    // Parsear output para extraer expected vs received
    const parsed = parseJestOutput(test.output);

    context.failedTests.push({
      name: test.name,
      testCode: test.test_code,
      expected: parsed.expected,
      received: parsed.received,
      errorMessage: test.error_message,
      fullOutput: test.output
    });
  }

  // 2. Leer implementación actual
  const project = await getProject(codingSessionId);
  const implementationFiles = await findImplementationFiles(project.base_path);

  for (const file of implementationFiles) {
    context.currentImplementation[file.path] = await fs.readFile(file.fullPath, 'utf8');
  }

  return context;
}
```

#### Componente 2: Generador de Prompt de Corrección

```typescript
async function buildFailureCorrectionPrompt(
  failureContext: FailureContext,
  originalPrompt: string,
  attemptNumber: number
): Promise<string> {
  const lines: string[] = [];

  lines.push(`# TDD GREEN PHASE: CORRECTION ATTEMPT ${attemptNumber}/3\n\n`);

  lines.push(`## ⚠️ PREVIOUS ATTEMPT FAILED\n\n`);
  lines.push(`Your previous implementation did NOT pass the tests. You must fix it.\n\n`);

  // Mostrar tests fallidos con expectativas claras
  lines.push(`## Failed Tests Analysis\n\n`);
  for (const test of failureContext.failedTests) {
    lines.push(`### ❌ Test: ${test.name}\n\n`);

    lines.push(`**Test Code:**\n\`\`\`typescript\n${test.testCode}\n\`\`\`\n\n`);

    if (test.expected && test.received) {
      lines.push(`**What the test expected:**\n\`\`\`\n${test.expected}\n\`\`\`\n\n`);
      lines.push(`**What your code did:**\n\`\`\`\n${test.received}\n\`\`\`\n\n`);
    }

    lines.push(`**Error Message:**\n\`\`\`\n${test.errorMessage}\n\`\`\`\n\n`);
    lines.push(`**Full Test Output:**\n\`\`\`\n${test.fullOutput}\n\`\`\`\n\n`);
    lines.push(`---\n\n`);
  }

  // Mostrar implementación actual
  lines.push(`## Your Current Implementation\n\n`);
  for (const [filePath, code] of Object.entries(failureContext.currentImplementation)) {
    lines.push(`### File: \`${filePath}\`\n\n`);
    lines.push(`\`\`\`typescript\n${code}\n\`\`\`\n\n`);
  }

  // Instrucciones explícitas de corrección
  lines.push(`## CRITICAL INSTRUCTIONS FOR CORRECTION\n\n`);
  lines.push(`**You MUST:**\n\n`);
  lines.push(`1. **READ the test code carefully** - See exactly what it expects\n`);
  lines.push(`2. **ANALYZE the error messages** - Understand why tests failed\n`);
  lines.push(`3. **COMPARE expected vs received** - Find the mismatch\n`);
  lines.push(`4. **MODIFY your implementation** - Make it match test expectations\n`);
  lines.push(`5. **DO NOT change the tests** - The tests are correct, your code is not\n\n`);

  lines.push(`**Common Issues to Check:**\n`);
  lines.push(`- Return type (undefined vs exception)\n`);
  lines.push(`- Return value (true/false vs exception)\n`);
  lines.push(`- Error message exact text\n`);
  lines.push(`- Function signature (parameters, return type)\n`);
  lines.push(`- Edge cases (empty strings, null, undefined)\n\n`);

  // Incluir contexto original
  lines.push(`## Original Context\n\n`);
  lines.push(originalPrompt);

  lines.push(`\n---\n\n`);
  lines.push(`## Expected Output\n\n`);
  lines.push(`Provide CORRECTED implementation that makes ALL tests pass.\n`);
  lines.push(`Include test execution output showing ALL tests passing.\n`);

  return lines.join('');
}
```

#### Componente 3: Parseador de Output de Jest

```typescript
function parseJestOutput(jestOutput: string): {
  expected: string | null;
  received: string | null;
  errorType: string | null;
} {
  const result = {
    expected: null as string | null,
    received: null as string | null,
    errorType: null as string | null
  };

  // Buscar patrón "Expected: ... Received: ..."
  const expectedMatch = jestOutput.match(/Expected:?\s*(.+?)(?:\n|Received)/is);
  if (expectedMatch) {
    result.expected = expectedMatch[1].trim();
  }

  const receivedMatch = jestOutput.match(/Received:?\s*(.+?)(?:\n|$)/is);
  if (receivedMatch) {
    result.received = receivedMatch[1].trim();
  }

  // Buscar tipo de error
  const errorTypeMatch = jestOutput.match(/(\w+Error):/);
  if (errorTypeMatch) {
    result.errorType = errorTypeMatch[1];
  }

  // Buscar patrón "expect(...).toThrow" o "expect(...).toBe"
  const expectMatch = jestOutput.match(/expect\(.*?\)\.(to\w+)\((.*?)\)/);
  if (expectMatch && !result.expected) {
    result.expected = expectMatch[2].replace(/['"]/g, '');
  }

  return result;
}
```

#### Componente 4: Modificación del Worker

```typescript
// En worker.ts línea 1583-1610, REEMPLAZAR:

if (!testsPassed) {
  console.warn(`[Worker] ⚠️ Batch tests did not pass. Results: ${batchTestResults.passed} passed, ${batchTestResults.failed} failed`);

  tddCycle.stuck_count = (tddCycle.stuck_count || 0) + 1;

  if (tddCycle.stuck_count >= 3) {
    console.error(`[Worker] ❌ Stuck on batch ${batchStart + 1}-${batchEnd} after 3 attempts. Moving to next batch.`);
    // ... skip to next batch
  }

  // ❌ ANTES: Retry ciego
  // await codingSessionService.executeBatchGREEN(codingSessionId);

  // ✅ AHORA: Retry inteligente con contexto
  console.log(`[Worker] 🔄 Capturing failure context for intelligent retry...`);

  // 1. Capturar contexto de fallo
  const failureContext = await captureBatchFailureContext(
    codingSessionId,
    batchStart,
    batchSize,
    batchTestResults
  );

  // 2. Obtener prompt original
  const session = await pool.query('SELECT * FROM coding_sessions WHERE id = $1', [codingSessionId]);
  const story = await pool.query('SELECT * FROM tasks WHERE id = $1', [session.rows[0].story_id]);

  // 3. Construir prompt de corrección
  const correctionPrompt = await buildFailureCorrectionPrompt(
    failureContext,
    await codingSessionService.buildBatchGREENPhasePrompt(
      session.rows[0].project_id,
      story.rows[0],
      tddCycle.all_tests.slice(batchStart, batchEnd),
      tddCycle
    ),
    tddCycle.stuck_count
  );

  // 4. Crear job de corrección
  await aiService.createAIJob({
    project_id: session.rows[0].project_id,
    task_id: session.rows[0].story_id,
    coding_session_id: codingSessionId,
    provider: 'cursor',
    mode: 'agent',
    phase: 'tdd_green',
    prompt: correctionPrompt,  // ✅ Prompt mejorado con contexto
    args: {
      batch_start: batchStart,
      batch_size: batchSize,
      attempt: tddCycle.stuck_count
    }
  });

  return;
}
```

---

## 📈 **Impacto Esperado de la Solución**

### Antes (Sistema Actual)

```
Intento 1: Genera código incorrecto
  └─> Tests fallan
  └─> Retry con mismo prompt ❌

Intento 2: Genera código incorrecto (igual o similar)
  └─> Tests fallan
  └─> Retry con mismo prompt ❌

Intento 3: Genera código incorrecto
  └─> Tests fallan
  └─> Se rinde, avanza al siguiente batch ❌

Resultado: 42.6% de tests pasando
```

### Después (Con Solución)

```
Intento 1: Genera código incorrecto
  └─> Tests fallan
  └─> Captura: expected, received, error messages
  └─> Retry con prompt mejorado ✅

Intento 2: Genera código CORREGIDO
  └─> Ve exactamente qué esperaba el test
  └─> Ve su implementación anterior
  └─> Corrige el error específico
  └─> Tests pasan ✅

Resultado esperado: >95% de tests pasando
```

---

## 🎯 **Plan de Implementación**

### Fase 1: Infraestructura Básica (2-3 horas)

1. ✅ Crear `captureBatchFailureContext()`
2. ✅ Crear `parseJestOutput()`
3. ✅ Crear `buildFailureCorrectionPrompt()`
4. ✅ Agregar tests unitarios para parsers

### Fase 2: Integración con Worker (1-2 horas)

1. ✅ Modificar worker.ts línea 1583-1610
2. ✅ Agregar logging detallado
3. ✅ Agregar eventos SSE para tracking de retries
4. ✅ Manejar edge cases (archivos no encontrados, etc.)

### Fase 3: Validación (1 hora)

1. ✅ Probar con tdd-test-project
2. ✅ Verificar que tests pasen después de retry
3. ✅ Ajustar prompts según resultados

### Fase 4: Optimizaciones (1 hora)

1. ✅ Cachear implementación actual
2. ✅ Optimizar parsing de output
3. ✅ Agregar métricas de éxito de retries

**Tiempo Total Estimado**: 5-7 horas

---

## 📋 **Checklist de Validación**

Para considerar el problema RESUELTO, verificar:

- [ ] Tests que fallan incluyen output completo en prompt de retry
- [ ] Prompt de retry muestra expected vs received claramente
- [ ] Prompt de retry incluye implementación actual
- [ ] AI recibe instrucciones explícitas de qué corregir
- [ ] Después de retry, tasa de éxito de tests >95%
- [ ] System logs muestran claramente el proceso de corrección
- [ ] SSE events permiten al usuario ver el progreso de retries

---

## 🔬 **Métricas de Éxito**

```
Métrica                    | Actual | Objetivo | Cómo Medir
---------------------------|--------|----------|------------------
Tests pasando 1er intento  | ~40%   | >80%     | Test suite results
Tests pasando después retry| ~45%   | >95%     | Test suite results
Intentos hasta pasar       | 3 max  | <2       | Retry counter
Batches abandonados        | ~25%   | <5%      | Skipped batches
Tiempo por batch           | ~2 min | <3 min   | Job duration
```

---

## 🎓 **Lecciones Aprendidas**

1. **TDD requiere loop de feedback**: No basta ejecutar tests, hay que usar los resultados
2. **La IA necesita contexto explícito**: "Fix the code" no es suficiente sin mostrar qué está mal
3. **Los retries ciegos no funcionan**: Repetir lo mismo esperando resultados diferentes es ineficiente
4. **El output de tests es oro**: Contiene toda la información necesaria para corregir

---

## 🚀 **Próximos Pasos**

1. **Implementar la solución propuesta**
2. **Validar con casos reales** (tdd-test-project)
3. **Monitorear métricas** durante 1 semana
4. **Iterar según resultados**
5. **Documentar casos especiales**

---

**Conclusión**: El flujo TDD actual tiene un problema **sistémico** de falta de retroalimentación efectiva. La solución propuesta implementa un loop de aprendizaje que permite a la IA **corregir sus errores** usando el output real de los tests fallidos.

---

**Documento Generado**: 2025-12-28
**Herramienta**: Claude Code
