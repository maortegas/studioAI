# Solución para Error ECANCELED con tsx

## Problema
El error `ECANCELED: operation canceled, read` ocurre cuando se usa `tsx watch` con Node.js v24.10.0.

## Soluciones

### Opción 1: Actualizar tsx (Recomendado)
Ejecuta estos comandos en tu terminal:

```bash
# Arreglar permisos de npm (solo una vez)
sudo chown -R 501:20 "/Users/mortegas/.npm"

# Actualizar tsx en backend
cd packages/backend
npm install tsx@latest --save-dev

# Actualizar tsx en worker
cd ../worker
npm install tsx@latest --save-dev
```

### Opción 2: Usar script sin watch (Temporal)
Si el problema persiste, usa el script `dev:no-watch`:

```bash
# Backend
npm run dev:no-watch --workspace=packages/backend

# Worker  
npm run dev:no-watch --workspace=packages/worker
```

**Nota**: Este script no recarga automáticamente cuando cambias archivos, pero evita el error ECANCELED.

### Opción 3: Usar nodemon + ts-node (Alternativa)
Si prefieres una alternativa más estable:

```bash
# Instalar nodemon y ts-node
cd packages/backend
npm install --save-dev nodemon ts-node

# Actualizar package.json script:
# "dev": "nodemon --exec ts-node src/server.ts"
```

### Opción 4: Usar tsc --watch + node (Otra alternativa)
Compilar TypeScript y ejecutar con node:

```bash
# Actualizar package.json scripts:
# "dev": "tsc --watch & node --watch dist/server.js"
```

## ¿Por qué ocurre?
El error ECANCELED es un problema conocido con `tsx watch` en Node.js v24 cuando hay cambios rápidos de archivos o cuando el proceso es interrumpido. Actualizar a la última versión de tsx generalmente lo resuelve.
