# Configuración de Cursor CLI para Modo Headless

## Problema
Cursor está abriendo el IDE cuando se ejecutan comandos. Necesitamos ejecutarlo en modo CLI puro sin abrir la interfaz gráfica.

## Soluciones Posibles

### Opción 1: Usar Cursor CLI separado (si existe)
Si Cursor tiene un comando CLI separado, configúralo en `packages/worker/src/cli/cursor.ts`:

```typescript
command = 'cursor-cli';  // o el nombre real del comando CLI
args = [mode, '--prompt', prompt, '--project', projectPath];
```

### Opción 2: Verificar comando real de Cursor
Ejecuta en terminal para ver los comandos disponibles:
```bash
cursor --help
cursor --version
which cursor
```

### Opción 3: Usar flags correctos
Los flags actuales son:
- `--headless`
- `--no-gui`
- `--cli`
- `--batch`
- `--non-interactive`

Si Cursor usa flags diferentes, ajusta en `packages/worker/src/cli/cursor.ts`.

### Opción 4: Usar stdin en lugar de argumentos
Si Cursor acepta input por stdin:
```typescript
const childProcess = spawn('cursor', ['--headless', '--stdin'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
childProcess.stdin.write(prompt);
childProcess.stdin.end();
```

### Opción 5: Verificar si hay un wrapper script
Algunos IDEs tienen scripts wrapper. Verifica:
- `/Applications/Cursor.app/Contents/Resources/app/bin/cursor` (macOS)
- `~/.cursor/bin/cursor`
- `cursor-cli` en PATH

## Variables de Entorno Configuradas

El worker ya configura estas variables para forzar modo CLI:
- `CURSOR_BATCH_MODE=1`
- `CURSOR_NON_INTERACTIVE=1`
- `CURSOR_NO_UI=1`
- `CURSOR_HEADLESS=1`
- `CURSOR_CLI_MODE=1`
- `CURSOR_SERVER_MODE=1`
- `CI=true` (en macOS)

## Próximos Pasos

1. Verifica qué comando CLI real tiene Cursor instalado
2. Ajusta el comando en `packages/worker/src/cli/cursor.ts` según la documentación oficial
3. Si Cursor no tiene modo CLI, considera usar la API de Cursor en lugar del CLI

