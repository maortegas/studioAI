# Tests - DevFlow Studio Backend

Este directorio contiene los tests para el backend de DevFlow Studio.

## Configuración

Los tests utilizan Jest como framework de testing. La configuración se encuentra en `jest.config.js`.

### Instalación de dependencias

```bash
npm install
```

Esto instalará Jest y ts-jest como dependencias de desarrollo.

## Ejecutar Tests

### Ejecutar todos los tests

```bash
npm test
```

### Ejecutar tests en modo watch

```bash
npm run test:watch
```

### Ejecutar tests con cobertura

```bash
npm run test:coverage
```

## Tests Implementados

### 1. Context Persistence Tests (`agentdb.context-persistence.test.ts`)

**TODO 23**: Test context persistence across multiple iterations of same feature

Este test verifica que:
- AgentDB persiste correctamente el contexto entre sesiones
- El contexto puede ser recuperado en iteraciones posteriores de la misma feature
- Las decisiones y el progreso se mantienen a través de múltiples sesiones
- El estado se persiste y puede ser cargado correctamente

**Cobertura**:
- `AgentDBContextManager`: Persistencia de contexto, decisiones, búsqueda
- `AgentDBStateManager`: Persistencia de estado, historial, actualizaciones

### 2. Traceability Validation Tests (`traceability.validation.test.ts`)

**TODO 24**: Test traceability validation prevents creating items without prerequisites

Este test verifica que:
- No se puede crear un diseño sin PRD vinculado a la historia
- No se puede hacer breakdown sin RFC aprobado
- No se puede codificar un epic sin RFC
- Se generan warnings apropiados cuando faltan prerequisitos opcionales
- Las validaciones bloquean operaciones inválidas

**Cobertura**:
- `TraceabilityService.validateCanProceed()`: Todas las validaciones de flujo
- Validaciones para: Story → Design, Story → RFC, RFC → Breakdown, Epic → Coding, Story → Coding

### 3. Completeness Dashboard Tests (`traceability.completeness.test.ts`)

**TODO 25**: Test completeness dashboard shows all gaps correctly

Este test verifica que:
- Se identifican correctamente los gaps en cada etapa del flujo
- El dashboard muestra historias sin PRD
- El dashboard muestra historias sin diseño
- El dashboard muestra RFCs no aprobados
- El dashboard muestra RFCs sin breakdown
- El dashboard muestra historias sin sesiones de codificación
- Las recomendaciones tienen las prioridades correctas

**Cobertura**:
- `TraceabilityService.checkProjectCompleteness()`: Verificación de completitud
- `TraceabilityService.getMissingItems()`: Identificación de gaps
- `TraceabilityService.getRecommendations()`: Generación de recomendaciones

## Variables de Entorno para Tests

Los tests utilizan las siguientes variables de entorno (con valores por defecto):

```env
NODE_ENV=test
DB_HOST=localhost
DB_PORT=5432
DB_NAME=devflow_test
DB_USER=postgres
DB_PASSWORD=postgres
```

## Notas

- Los tests de AgentDB utilizan directorios temporales que se limpian automáticamente
- Los tests de traceability utilizan mocks de repositorios para evitar dependencias de base de datos
- Los tests tienen un timeout de 30 segundos para permitir operaciones de base de datos

## Próximos Pasos

Para mejorar la cobertura de tests:

1. **Tests de integración**: Crear tests que usen una base de datos real (test database)
2. **Tests E2E**: Crear tests end-to-end para el flujo completo
3. **Tests de performance**: Verificar que AgentDB maneja correctamente grandes volúmenes de datos
4. **Tests de error handling**: Verificar manejo de errores en todos los servicios

