# Configuración de cursor-agent

## Instalación

Cursor-agent es el CLI de Cursor que permite ejecutar comandos de IA sin abrir el IDE.

### Instalar cursor-agent

```bash
curl https://cursor.com/install -fsS | bash
```

Este comando instala `cursor-agent` en tu sistema.

### Verificar instalación

```bash
which cursor-agent
cursor-agent --help
```

## Uso

### Ejemplo básico

```bash
cursor-agent --print "Corre los tests y resume los failures"
```

### En DevFlow Studio

El worker usa automáticamente `cursor-agent` con estos parámetros:

```bash
cursor-agent --print --output-format text "<PRD completo y prompt de arquitectura>"
```

El directorio de trabajo se establece automáticamente en el directorio del proyecto.

### Flags utilizados

- `--print`: Modo no interactivo - imprime respuestas a consola (no abre IDE)
- `--output-format text`: Formato de salida como texto
- El prompt se pasa como argumento (incluye el PRD completo - idea del proyecto)

## Ventajas

- ✅ No abre el IDE de Cursor
- ✅ Ejecuta comandos de IA directamente
- ✅ Modo batch/no interactivo
- ✅ Incluye el PRD completo en el prompt

## Troubleshooting

Si `cursor-agent` no está disponible:

1. Verifica la instalación: `which cursor-agent`
2. Reinstala si es necesario: `curl https://cursor.com/install -fsS | bash`
3. Verifica que esté en tu PATH
4. Reinicia el worker después de instalar

