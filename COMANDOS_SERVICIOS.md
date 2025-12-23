# Comandos para Ejecutar Servicios

## 🚀 Iniciar Todos los Servicios

### Opción 1: Terminales Separadas (Recomendado)

Abre 4 terminales y ejecuta en cada una:

**Terminal 1 - Base de Datos:**
```bash
cd /Users/mortegas/Documents/StudioIA
docker compose up postgres
```

**Terminal 2 - Backend:**
```bash
cd /Users/mortegas/Documents/StudioIA
npm run dev:backend
```

**Terminal 3 - Frontend:**
```bash
cd /Users/mortegas/Documents/StudioIA
npm run dev:frontend
```

**Terminal 4 - Worker:**
```bash
cd /Users/mortegas/Documents/StudioIA
npm run dev:worker
```

### Opción 2: En Background (Para Desarrollo)

```bash
# Base de datos (si no está corriendo)
docker compose up -d postgres

# Backend (background)
npm run dev:backend &

# Frontend (background)
npm run dev:frontend &

# Worker (background)
npm run dev:worker &
```

## 📍 Puertos y URLs

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **PostgreSQL**: localhost:5432
- **Worker**: Proceso en background (sin puerto)

## 🛑 Detener Servicios

```bash
# Detener procesos Node.js
pkill -f "npm run dev"

# O detener por puerto
lsof -ti:3000 | xargs kill  # Frontend
lsof -ti:3001 | xargs kill  # Backend

# Detener base de datos
docker compose down

# Detener todo
docker compose down && pkill -f "npm run dev"
```

## ✅ Verificar Estado

```bash
# Ver procesos corriendo
lsof -i:3000  # Frontend
lsof -i:3001  # Backend
docker ps     # PostgreSQL

# Ver logs
docker compose logs -f postgres  # Base de datos
# Los logs de Node.js aparecen en las terminales donde se ejecutaron
```

## 🔧 Configuración

- **Backend**: Puerto 3001 (configurado en `packages/backend/src/server.ts`)
- **Frontend**: Puerto 3000 (configurado en `packages/frontend/vite.config.ts`)
- **Database**: Puerto 5432 (configurado en `docker-compose.yml`)

## 📝 Notas

- Los servicios deben iniciarse en orden: Database → Backend → Frontend → Worker
- El backend necesita la base de datos corriendo
- El frontend necesita el backend corriendo (para el proxy)
- El worker necesita el backend corriendo (para obtener jobs)
