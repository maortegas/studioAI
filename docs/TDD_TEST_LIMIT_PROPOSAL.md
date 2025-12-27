# Propuesta: Limitar Número de Tests Generados

## 🚨 Problema Actual

**Caso Real:**
- Historia de Usuario: 2 criterios de aceptación
- Tests generados: **50 tests**
- Ratio: **25 tests por criterio de aceptación** ❌

**Causa:**
- El prompt dice "comprehensive test suites" sin límite
- La IA genera tests para todos los casos edge posibles
- No hay control sobre la cantidad

**Impacto:**
- 50 tests × 3 fases = **150 jobs** (muy ineficiente)
- Tiempo de ejecución muy largo
- Costos elevados
- Rate limiting

## 💡 Solución Propuesta

### Opción 1: Límite en el Prompt (Implementado)

Agregar guías claras en el prompt:

```
Generate 8-15 tests maximum
- Focus on core functionality
- Include edge cases selectively
- Avoid redundant tests
```

**Ventajas:**
- La IA se autolimita
- Más control sobre la cantidad
- Tests más enfocados

**Desventajas:**
- La IA puede ignorar el límite
- No es garantizado

### Opción 2: Límite en el Parsing (Recomendado)

Después de parsear, limitar a un máximo:

```typescript
async function parseGeneratedTests(output: string): Promise<Array<{name: string; code: string}>> {
  const tests = await parseTests(output);
  
  const MAX_TESTS = 15; // Límite máximo
  
  if (tests.length > MAX_TESTS) {
    console.warn(`[Worker] Generated ${tests.length} tests, limiting to ${MAX_TESTS}`);
    
    // Priorizar tests más importantes
    // 1. Tests que mencionan acceptance criteria
    // 2. Tests con nombres más descriptivos
    // 3. Tests más cortos (probablemente más enfocados)
    
    return tests.slice(0, MAX_TESTS);
  }
  
  return tests;
}
```

**Ventajas:**
- Garantizado: siempre respeta el límite
- Funciona incluso si la IA ignora el prompt
- Control total

**Desventajas:**
- Puede descartar tests importantes
- Requiere lógica de priorización

### Opción 3: Híbrido (Mejor)

Combinar ambas:
1. Prompt con límite claro
2. Parsing con límite de seguridad

```typescript
// En el prompt
lines.push(`Generate 8-15 focused tests maximum`);

// En parseGeneratedTests
const MAX_TESTS = 15;
if (tests.length > MAX_TESTS) {
  // Limitar y loggear
}
```

## 📊 Comparación

| Métrica | Actual | Con Límite 15 |
|---------|--------|---------------|
| Tests típicos | 30-50 | 8-15 |
| Jobs (3 fases) | 90-150 | 24-45 |
| Reducción | - | 70-80% |
| Tiempo estimado | 90-150h | 24-45h |

## 🔧 Implementación

### 1. Actualizar Prompt (Ya hecho)

```typescript
lines.push(`Generate 8-15 tests maximum`);
lines.push(`Focus on core functionality`);
```

### 2. Agregar Límite en Parsing

```typescript
// packages/worker/src/worker.ts:4034
async function parseGeneratedTests(output: string): Promise<Array<{name: string; code: string}>> {
  const tests: Array<{name: string; code: string}> = [];
  
  // ... parsing logic ...
  
  const MAX_TESTS = 15;
  
  if (tests.length > MAX_TESTS) {
    console.warn(
      `[Worker] Generated ${tests.length} tests, limiting to ${MAX_TESTS} ` +
      `(original limit was 8-15 in prompt)`
    );
    
    // Tomar los primeros MAX_TESTS
    // En el futuro, se puede implementar priorización inteligente
    return tests.slice(0, MAX_TESTS);
  }
  
  return tests;
}
```

### 3. Configuración

Hacer el límite configurable:

```typescript
const TDD_MAX_TESTS = process.env.TDD_MAX_TESTS 
  ? parseInt(process.env.TDD_MAX_TESTS) 
  : 15;
```

## ✅ Beneficios

1. **Reducción masiva de jobs:** 70-80% menos jobs
2. **Tests más enfocados:** Calidad sobre cantidad
3. **Más rápido:** Menos tiempo de ejecución
4. **Menor costo:** Menos llamadas a la API
5. **Mejor UX:** Progreso más rápido y visible

## ⚠️ Consideraciones

1. **Tests importantes:** Algunos tests pueden quedar fuera
   - **Solución:** Priorización inteligente (futuro)
   - **Mitigación:** Prompt mejorado para generar tests más relevantes

2. **Cobertura:** Menos tests = menos cobertura
   - **Mitigación:** Enfocarse en tests de alta calidad
   - **Futuro:** Generar tests adicionales después si es necesario

3. **Historias complejas:** Algunas historias pueden necesitar más tests
   - **Solución:** Límite configurable por tipo de historia
   - **Alternativa:** Permitir hasta 20 tests para historias complejas

## 🚀 Próximos Pasos

1. ✅ Actualizar prompt con límite (hecho)
2. ⏳ Agregar límite en parsing
3. ⏳ Hacer límite configurable
4. ⏳ Probar con casos reales
5. ⏳ Ajustar límite según resultados

