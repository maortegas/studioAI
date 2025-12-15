# CLI Reference for AI Providers

## Cursor CLI (cursor-agent)

El worker ejecuta comandos usando `cursor-agent`, el CLI oficial de Cursor que se instala con:
```bash
curl https://cursor.com/install -fsS | bash
```

### Flags utilizados

- `--print`: Modo no interactivo - imprime respuestas a consola (no abre IDE)
- `--output-format text`: Formato de salida como texto
- El prompt se pasa como argumento (no como flag)

**Comando ejecutado:**
```bash
cursor-agent --print --output-format text "<PRD completo y prompt de arquitectura>"
```

**Ejemplo real:**
```bash
cursor-agent --print "Corre los tests y resume los failures"
```

**Nota:** El directorio de trabajo se establece automáticamente mediante `cwd` en el spawn, no como argumento `--cwd`.

### Instalación

Si `cursor-agent` no está instalado:
```bash
curl https://cursor.com/install -fsS | bash
```

Verificar instalación:
```bash
which cursor-agent
```

**Nota**: Ver `CURSOR_AGENT_SETUP.md` para más detalles sobre la instalación y configuración.

## Claude CLI

Similar a Cursor, el worker ejecuta comandos de Claude CLI en modo batch:

- `--batch`: Ejecuta en modo batch
- `--non-interactive`: Modo no interactivo  
- `--no-ui`: No abre ventanas de UI
- `--prompt`: El prompt completo que incluye el PRD (idea del proyecto)
- `--project`: Ruta del proyecto
- `--output stdout`: Salida a stdout en lugar de archivo

**Variables de entorno configuradas:**
- `CLAUDE_BATCH_MODE=1`
- `CLAUDE_NON_INTERACTIVE=1`
- `CLAUDE_NO_UI=1`

**Comando ejecutado:**
```bash
claude plan --batch --non-interactive --no-ui --prompt "<PRD completo>" --project <ruta> --output stdout
```

**Nota**: Si la implementación real de Claude CLI usa flags diferentes, ajustar en `packages/worker/src/cli/claude.ts`

## Modo de Ejecución

Los procesos se ejecutan con:
- `stdio: ['pipe', 'pipe', 'pipe']`: No hereda stdin/stdout/stderr del proceso padre (evita abrir ventanas)
- `detached: false`: No se desvincula del proceso padre (evita crear nuevas ventanas)
- `shell: true`: Ejecuta en shell para mejor compatibilidad

## Contexto del Proyecto - PRD Completo

El PRD (Product Requirements Document) COMPLETO se incluye automáticamente en el prompt para todas las generaciones de arquitectura. El sistema:

1. **Lee el PRD completo del proyecto** desde `artifacts/PRD.md`
2. **Lo incluye al inicio del prompt bundle** con toda la información:
   - Información del proyecto (nombre, tech stack)
   - PRD completo (idea del proyecto, problema, usuarios, objetivos, restricciones, etc.)
   - Arquitectura existente (si existe)
   - Historias de usuario (si existen)
3. **Lo pasa a la IA como contexto principal** en el comando CLI
4. **La IA genera la arquitectura** basada en la idea completa del proyecto

### Validación del PRD

- Si no existe PRD, la generación de arquitectura **falla con error 400**
- El PRD es **obligatorio** para generar arquitectura
- El prompt incluye el PRD completo, no un resumen

### Logging

El worker registra:
- Confirmación de que el PRD está incluido en el prompt
- Longitud del prompt (para verificar que incluye el PRD completo)
- Comando CLI ejecutado
- Resultado de la ejecución

