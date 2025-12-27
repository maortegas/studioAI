---
name: TDD Traditional File Structure
overview: "Refactor TDD implementation to use traditional TDD file structure: all tests in `tests/unit/` with one file per functionality (based on story/task title), iterating over the same file instead of creating session-specific folders."
todos: []
---

# P

lan: Implement Traditional TDD File Structure

## Objetivo

Refactorizar el sistema TDD para que funcione como TDD tradicional:

- Tests en `tests/unit/` (no en `tests/session_{id}/`)
- Un archivo por funcionalidad basado en el título (ej: `message-logs.test.js`)
- Iterar sobre el mismo archivo: agregar tests al existente, no crear desde cero
- Las fases GREEN/REFACTOR trabajan sobre el archivo existente

## Cambios Requeridos

### 1. Modificar `parseAndSaveTestSuites` en `packages/worker/src/worker.ts`

**Ubicación**: Líneas 3499-3615**Cambios**:

- Eliminar creación de `tests/session_{coding_session_id}/`
- Usar `tests/unit/` como directorio base
- Obtener el título de la historia/tarea para nombrar el archivo
- Si el archivo ya existe, **agregar** tests al existente (append) en lugar de sobrescribir
- Nombre del archivo: `{story-title-sanitized}.test.js` (ej: `message-logs.test.js`)

**Código a modificar**:

```typescript
// ANTES (línea 3517):
const testsDir = path.join(project.base_path, 'tests', `session_${codingSessionId}`);

// DESPUÉS:
const testPath = getRecommendedPath('', 'test', tech_stack); // ej: 'tests'
const testsDir = path.join(project.base_path, testPath, 'unit');

// Obtener título de la historia/tarea
const storyResult = await pool.query('SELECT title FROM tasks WHERE id = $1', [storyId]);
const storyTitle = storyResult.rows[0]?.title || 'default';
const sanitizedTitle = storyTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const fileName = `${sanitizedTitle}.test.js`;
const filePath = path.join(testsDir, fileName);

// Si el archivo existe, agregar tests (append)
if (await fs.access(filePath).then(() => true).catch(() => false)) {
  const existingContent = await fs.readFile(filePath, 'utf8');
  suiteData.code = existingContent + '\n\n' + suiteData.code;
}
```



### 2. Modificar `testSuiteService.saveTestCodeToFile` en `packages/backend/src/services/testSuiteService.ts`

**Ubicación**: Líneas 75-121**Cambios**:

- Eliminar lógica de `tests/session_{coding_session_id}/`
- Para TDD (cuando hay `coding_session_id`), usar `tests/unit/` siempre
- Obtener el título de la historia para nombrar el archivo
- Si el archivo existe, agregar contenido (append) en lugar de sobrescribir

**Código a modificar**:

```typescript
// ANTES (líneas 88-104):
if (suite.coding_session_id) {
  const sessionDir = path.join(testDir, `session_${suite.coding_session_id}`);
  // ...
}

// DESPUÉS:
// Usar ProjectStructureService para obtener la ruta correcta
const { ProjectStructureService } = await import('./projectStructureService');
const structureService = new ProjectStructureService();
const testPath = structureService.getRecommendedPath('', 'test', project.tech_stack);
const unitTestDir = path.join(project.base_path, testPath, 'unit');

// Obtener título de la historia
const storyResult = await pool.query('SELECT title FROM tasks WHERE id = $1', [suite.story_id]);
const storyTitle = storyResult.rows[0]?.title || 'default';
const sanitizedTitle = storyTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const fileName = `${sanitizedTitle}.test.js`;
const filePath = path.join(unitTestDir, fileName);

// Si existe, agregar (append)
if (await fs.access(filePath).then(() => true).catch(() => false)) {
  const existing = await fs.readFile(filePath, 'utf8');
  testCode = existing + '\n\n' + testCode;
}
```



### 3. Actualizar prompts de GREEN y REFACTOR en `packages/backend/src/services/codingSessionService.ts`

**Ubicación**:

- `buildBatchGREENPhasePrompt` (línea ~1350)
- `buildREFACTORPhasePrompt` (línea ~1400)

**Cambios**:

- Especificar que los tests ya existen en `tests/unit/{story-title}.test.js`
- Indicar que debe **modificar** el archivo existente, no crear nuevos
- Proporcionar la ruta exacta del archivo de test
- En GREEN: implementar código para que los tests existentes pasen
- En REFACTOR: mejorar código manteniendo los tests existentes

**Código a agregar en `buildBatchGREENPhasePrompt`**:

```typescript
// Obtener título de la historia para la ruta del test
const storyTitle = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const testFilePath = `tests/unit/${storyTitle}.test.js`;

lines.push(`## Existing Test File\n\n`);
lines.push(`**IMPORTANT:** Tests already exist in: \`${testFilePath}\`\n`);
lines.push(`- Do NOT create new test files\n`);
lines.push(`- Work with the existing test file: \`${testFilePath}\`\n`);
lines.push(`- Implement code to make ALL tests in this file pass\n`);
lines.push(`- If you need to add more test cases, add them to the SAME file\n\n`);
```

**Código a agregar en `buildREFACTORPhasePrompt`**:

```typescript
// Similar al anterior, pero enfocado en refactoring
lines.push(`## Existing Test File\n\n`);
lines.push(`**IMPORTANT:** Tests exist in: \`${testFilePath}\`\n`);
lines.push(`- All tests in \`${testFilePath}\` must continue passing after refactoring\n`);
lines.push(`- Do NOT modify the test file unless necessary for refactoring\n\n`);
```



### 4. Actualizar `buildTestGenerationPrompt` en `packages/backend/src/services/codingSessionService.ts`

**Ubicación**: Línea ~560**Cambios**:

- Especificar que los tests se guardarán en `tests/unit/{story-title}.test.js`
- Indicar que si el archivo ya existe, se agregarán tests al existente

**Código a modificar**:

```typescript
// Agregar después de la línea 570:
const storyTitle = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
lines.push(`**Test File Location:**\n`);
lines.push(`- Save tests in: \`${testPath}/unit/${storyTitle}.test.js\`\n`);
lines.push(`- If the file already exists, ADD your tests to it (do not overwrite)\n`);
lines.push(`- All tests for this functionality should be in the SAME file\n\n`);
```



### 5. Actualizar referencias en la base de datos

**Archivo**: `packages/worker/src/worker.ts` (línea 3600)**Cambio**:

- Actualizar `file_path` en la base de datos para usar `tests/unit/` en lugar de `tests/session_{id}/`
```typescript
// ANTES:
`tests/session_${codingSessionId}/${fileName}`

// DESPUÉS:
`tests/unit/${sanitizedTitle}.test.js`
```




## Flujo Esperado

```javascript
1. Test Generation (TDD)
   └─> Crea/agrega a: tests/unit/message-logs.test.js
   
2. GREEN Phase (Batch 1)
   └─> Lee: tests/unit/message-logs.test.js
   └─> Implementa código para que tests pasen
   └─> NO crea nuevos archivos de test
   
3. GREEN Phase (Batch 2)
   └─> Lee: tests/unit/message-logs.test.js (mismo archivo)
   └─> Implementa código para nuevos tests
   └─> NO crea nuevos archivos de test
   
4. REFACTOR Phase
   └─> Lee: tests/unit/message-logs.test.js (mismo archivo)
   └─> Refactoriza código manteniendo tests pasando
   └─> NO modifica el archivo de test
```



## Archivos a Modificar

1. `packages/worker/src/worker.ts` - Función `parseAndSaveTestSuites`
2. `packages/backend/src/services/testSuiteService.ts` - Método `saveTestCodeToFile`
3. `packages/backend/src/services/codingSessionService.ts` - Prompts de GREEN, REFACTOR y test generation

## Consideraciones

- **Sanitización de títulos**: Convertir títulos a nombres de archivo válidos (lowercase, sin espacios, solo alfanuméricos y guiones)
- **Append vs Overwrite**: Siempre agregar tests al archivo existente, nunca sobrescribir
- **Ruta de tests**: Usar `ProjectStructureService.getRecommendedPath()` para obtener la ruta correcta según tech stack
- **Compatibilidad**: Mantener compatibilidad con tests existentes que puedan estar en otras ubicaciones

## Testing

Después de implementar:

1. Crear una nueva sesión TDD
2. Verificar que los tests se crean en `tests/unit/{story-title}.test.js`
3. Verificar que las fases GREEN/REFACTOR trabajan sobre el mismo archivo