# 📝 Instrucciones para Commit del Worker TDD

## ✅ Estado Actual

- **Commit 1**: ✅ Realizado (f173d87) - TDD 3 fases en CodingSessionService
- **Commit 2**: ⚠️ PENDIENTE - Worker support para TDD 3 fases

## 📦 Archivos Modificados Pendientes

```
packages/worker/src/worker.ts
```

## 🔧 Comandos para Ejecutar

Abre tu terminal (fuera de Cursor si es necesario) y ejecuta:

```bash
cd /Users/mortegas/Documents/StudioIA

# Verificar cambios
git status

# Agregar archivo modificado
git add packages/worker/src/worker.ts

# Hacer commit
git commit -m "feat: implement worker support for TDD Red-Green-Refactor cycle

- Add isTDDPhase flag to detect TDD phase jobs
- Implement TDD cycle initialization in test_generation phase:
  * Check for tdd_mode=strict flag
  * Parse generated tests from AI output
  * Call codingSessionService.initializeTDDCycle()
  * Maintain backward compatibility with legacy TDD mode

- Add TDD phase handlers for job completion:
  * tdd_red: Verify test fails, move to GREEN phase
  * tdd_green: Verify test passes, move to REFACTOR phase
    - Implement retry logic with stuck_count (max 3 attempts)
    - Skip to next test if stuck
  * tdd_refactor: Verify all tests still pass, advance to next test

- Add parseGeneratedTests() helper function:
  * Supports multiple test formats: JSON, Jest/Mocha, pytest, JUnit
  * Extracts test name and code from AI output
  * Falls back to entire output if no structure found
  * Handles 5 different test pattern styles

- TDD cycle automatically advances through all tests until completion
- Each phase validates output and handles errors gracefully
- Logs detailed progress for each TDD phase transition"

# Verificar commit
git log --oneline -3
```

## 📊 Cambios Implementados en Worker

### 1. Detección de Fases TDD
- Línea 326: `isTDDPhase` flag

### 2. Inicialización del Ciclo
- Líneas 599-651: Manejo de `tdd_mode='strict'`
- Llamada a `initializeTDDCycle()`

### 3. Handlers de Fases
- Líneas 893-1002: Handlers para RED, GREEN, REFACTOR

### 4. Parser de Tests
- Líneas 4034-4130: Función `parseGeneratedTests()`

## ✅ Verificación

Después del commit, deberías ver:
```
f173d87 feat: implement full TDD Red-Green-Refactor cycle...
[TU_NUEVO_COMMIT] feat: implement worker support for TDD...
```

