# CLI Reference for AI Providers

## Cursor CLI

El worker ejecuta comandos de Cursor CLI en modo batch/no interactivo. Los flags utilizados son:

- `--batch`: Ejecuta en modo batch (sin interacción)
- `--non-interactive`: Modo no interactivo
- `--no-ui`: No abre ventanas de UI

**Nota**: Si la implementación real de Cursor CLI usa flags diferentes, ajustar en `packages/worker/src/cli/cursor.ts`

Ejemplos de comandos alternativos que podrían funcionar:
- `cursor --headless --stdin` (si acepta input por stdin)
- `cursor --batch-mode`
- `cursor --cli-only`

## Claude CLI

Similar a Cursor, el worker ejecuta comandos de Claude CLI en modo batch:

- `--batch`: Ejecuta en modo batch
- `--non-interactive`: Modo no interactivo  
- `--no-ui`: No abre ventanas de UI

**Nota**: Si la implementación real de Claude CLI usa flags diferentes, ajustar en `packages/worker/src/cli/claude.ts`

## Modo de Ejecución

Los procesos se ejecutan con:
- `stdio: ['pipe', 'pipe', 'pipe']`: No hereda stdin/stdout/stderr del proceso padre (evita abrir ventanas)
- `detached: false`: No se desvincula del proceso padre (evita crear nuevas ventanas)
- `shell: true`: Ejecuta en shell para mejor compatibilidad

## Contexto del Proyecto

El PRD (Product Requirements Document) se incluye automáticamente en el prompt para todas las generaciones de arquitectura. El sistema:

1. Lee el PRD del proyecto
2. Lo incluye al inicio del prompt bundle
3. Lo pasa a la IA como contexto principal
4. Genera la arquitectura basada en la idea del proyecto

