# Integración de Cursor AI sin Abrir el IDE

## ⚠️ Problema Actual

El comando `cursor` estándar **solo abre el IDE de Cursor**, no ejecuta comandos de IA directamente desde la línea de comandos. Esto causa que se abra la interfaz gráfica cuando se intenta generar arquitectura.

**Verificado**: El comando `cursor --help` muestra que solo tiene opciones para abrir archivos, no comandos de IA.

## Soluciones Posibles

### Opción 1: Usar Cursor API (Recomendado)

Si Cursor tiene una API HTTP o de otro tipo para ejecutar comandos de IA:

1. Verificar si Cursor expone una API local
2. Hacer requests HTTP a la API en lugar de ejecutar comandos CLI
3. Implementar en `packages/worker/src/cli/cursor.ts`

### Opción 2: Script Wrapper

Crear un script wrapper que:
1. Se conecte a Cursor via API o extensión
2. Ejecute el comando de IA
3. Retorne el resultado sin abrir UI

Ejemplo de estructura:
```bash
#!/bin/bash
# cursor-ai-wrapper.sh
cursor-api execute --mode "$1" --prompt "$2" --project "$3" --headless
```

### Opción 3: Usar Extensión de Cursor

Si Cursor tiene un sistema de extensiones que puede ejecutarse desde CLI:
1. Crear/instalar extensión que ejecute comandos de IA
2. Ejecutar extensión desde CLI sin abrir UI

### Opción 4: Configurar Cursor para Modo Headless

Si Cursor soporta modo headless:
1. Verificar documentación de Cursor para flags headless
2. Configurar variables de entorno apropiadas
3. Usar flags correctos en el comando

### Opción 5: Usar Claude API Directamente ✅ IMPLEMENTADO

**SOLUCIÓN RECOMENDADA**: Usar la API de Claude directamente (ya implementado).

1. **Configurar API key de Claude:**
   ```bash
   export CLAUDE_API_KEY="tu-api-key-aqui"
   # o
   export ANTHROPIC_API_KEY="tu-api-key-aqui"
   ```

2. **El worker automáticamente usará la API** si encuentra la API key
3. **No abre el IDE** - funciona completamente en modo batch
4. **Incluye el PRD completo** en el prompt

**Ventajas:**
- ✅ No abre el IDE
- ✅ Ejecución más rápida
- ✅ Más confiable
- ✅ Mismo resultado (genera arquitectura basada en PRD)

**Cómo usar:**
1. Obtén una API key de Anthropic/Claude
2. Configúrala como variable de entorno
3. El worker la usará automáticamente en lugar del CLI

## Implementación Actual

### Claude (Recomendado)
- ✅ **Claude API**: Implementado en `packages/worker/src/cli/claudeApi.ts`
- ✅ Se usa automáticamente si `CLAUDE_API_KEY` está configurada
- ✅ No abre el IDE
- ✅ Funciona en modo batch completo

### Cursor
- ⚠️ **Cursor CLI**: Intenta ejecutar comandos pero puede abrir el IDE
- ⚠️ El código actual tiene workarounds pero no son 100% efectivos
- 📝 Se necesita usar API de Cursor o encontrar el comando CLI correcto

## Próximos Pasos

1. **Verificar documentación oficial de Cursor** para comandos CLI de IA
2. **Probar con Cursor API** si está disponible
3. **Considerar usar Claude API directamente** como alternativa
4. **Crear script wrapper** si es necesario

## Nota Importante

El sistema está diseñado para funcionar con CLIs de IA, pero si Cursor no tiene CLI de IA disponible, se necesita:
- Usar la API de Cursor directamente
- O usar Claude API directamente
- O esperar a que Cursor agregue soporte CLI para comandos de IA

