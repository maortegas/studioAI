# Nueva Arquitectura del Sistema de Tests

## Visión General

Se ha reformulado completamente el sistema de generación, implementación y ejecución de tests para crear un flujo integrado y automatizado que sigue las mejores prácticas de Test-Driven Development (TDD).

## Arquitectura Nueva

### 1. Estructura de Datos

#### Tabla `test_suites`
- **Propósito**: Gestionar suites de tests de forma estructurada
- **Campos clave**:
  - `coding_session_id`: Vincula tests con la sesión de codificación
  - `story_id`: Vincula tests con la historia de usuario
  - `test_type`: unit, integration, e2e, performance, security
  - `status`: pending, generating, ready, running, passed, failed, skipped
  - `test_code`: Código del test
  - `file_path`: Ruta del archivo en el sistema de archivos

#### Tabla `test_executions`
- **Propósito**: Trackear ejecuciones de tests
- **Campos clave**:
  - `test_suite_id`: Suite que se ejecutó
  - `execution_type`: auto, manual, ci
  - `status`: running, passed, failed, skipped, error
  - Métricas: total_tests, passed_tests, failed_tests, skipped_tests
  - `duration`: Tiempo de ejecución en ms

### 2. Flujo Integrado

```
┌─────────────────────────────────────────────────────────────┐
│ 1. GENERACIÓN DE TESTS (TDD - Tests First)                  │
│    - Se crea coding session                                 │
│    - AI genera tests ANTES de implementar                    │
│    - Tests se guardan como test_suites                       │
│    - Tests se guardan en tests/session_{id}/                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. IMPLEMENTACIÓN (Code to Pass Tests)                      │
│    - AI implementa código usando tests como guía            │
│    - Código se genera en el proyecto                        │
│    - Tests ya están listos para ejecutar                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. EJECUCIÓN AUTOMÁTICA                                     │
│    - Al completar implementación, tests se ejecutan auto    │
│    - Se crean registros en test_executions                  │
│    - Resultados se guardan y actualizan status              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. QA COMPREHENSIVE                                         │
│    - Si tests pasan, se ejecuta QA completo                 │
│    - QA incluye análisis adicional y coverage                │
└─────────────────────────────────────────────────────────────┘
```

### 3. Organización de Archivos

```
project/
  ├── src/                    # Código implementado
  ├── tests/                  # Tests organizados por sesión
  │   └── session_{id}/
  │       ├── unit_backend_unit_tests.test.js
  │       ├── integration_backend_integration_tests.test.js
  │       └── e2e_backend_e2e_tests.test.js
  └── artifacts/              # Documentación y reportes
```

### 4. Ventajas de la Nueva Arquitectura

#### Integración Completa
- Tests están vinculados directamente con código implementado
- Cada coding session tiene sus propios test suites
- Trazabilidad completa: story → tests → implementation → execution

#### Automatización
- Generación automática de tests (TDD)
- Ejecución automática después de implementación
- Sin intervención manual necesaria

#### Organización
- Tests organizados por tipo (unit, integration, e2e)
- Un test suite por tipo de test
- Fácil de encontrar y gestionar

#### Tracking Detallado
- Historial completo de ejecuciones
- Métricas por suite y por ejecución
- Status en tiempo real

#### Flexibilidad
- Tests pueden editarse manualmente
- Tests pueden ejecutarse manualmente
- Tests pueden eliminarse si no son necesarios

## API Endpoints

### Test Suites
- `GET /api/test-suites/session/:codingSessionId` - Obtener suites de una sesión
- `GET /api/test-suites/:suiteId` - Obtener suite específico
- `POST /api/test-suites` - Crear suite manualmente
- `PUT /api/test-suites/:suiteId` - Editar suite
- `POST /api/test-suites/:suiteId/execute` - Ejecutar suite
- `DELETE /api/test-suites/:suiteId` - Eliminar suite

## Comparación: Antes vs Ahora

### Antes
- ❌ Tests generados en `artifacts/TESTS_{qaSessionId}/`
- ❌ Tests separados del código implementado
- ❌ Ejecución manual o solo en QA sessions
- ❌ Sin tracking estructurado
- ❌ Tests por funcionalidad (múltiples archivos)

### Ahora
- ✅ Tests en `tests/session_{codingSessionId}/`
- ✅ Tests integrados con código (mismo contexto)
- ✅ Ejecución automática después de implementación
- ✅ Tracking completo con test_suites y test_executions
- ✅ Tests organizados por tipo (unit, integration, e2e)

## Próximos Pasos

1. **Implementar ejecución real de tests** basada en tech stack
2. **UI mejorada** para mostrar tests integrados con código
3. **Test runners** específicos por stack (Jest, Mocha, pytest, etc.)
4. **Coverage reporting** integrado
5. **CI/CD integration** para ejecutar tests en pipeline
