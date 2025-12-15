# DevFlow Studio

DevFlow Studio es una herramienta que permite gestionar proyectos de software de manera eficiente, utilizando inteligencia artificial para generar y automatizar la creación de documentación, planificación, codificación y seguimiento del ciclo de vida del proyecto.

## Arquitectura

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Express + Node.js + TypeScript
- **Database**: PostgreSQL
- **Worker**: AI Worker que ejecuta comandos CLI locales (Cursor/Claude)

## Estructura del Monorepo

```
StudioIA/
├── packages/
│   ├── frontend/          # React + Vite + Tailwind
│   ├── backend/           # Express API
│   ├── worker/            # AI Worker (spawn CLI commands)
│   └── shared/            # Tipos TypeScript compartidos
├── database/
│   ├── migrations/        # Migraciones PostgreSQL
│   └── scripts/           # Scripts de base de datos
├── scripts/               # Scripts de utilidad
├── docker-compose.yml     # Configuración de PostgreSQL
└── package.json           # Root workspace config
```

## Desarrollo

### Prerrequisitos

- Node.js >= 18.0.0
- Docker y Docker Compose
- npm

### Instalación

```bash
npm install
```

### Configuración de Base de Datos con Docker

La base de datos PostgreSQL se ejecuta en un contenedor Docker para mantener todo el proyecto autocontenido.

1. **Iniciar PostgreSQL y ejecutar migraciones:**
```bash
./scripts/setup-db.sh
```

Este script:
- Inicia el contenedor de PostgreSQL
- Espera a que esté listo
- Ejecuta las migraciones automáticamente

2. **Detener la base de datos:**
```bash
./scripts/stop-db.sh
```

O manualmente:
```bash
docker compose down
```

**Configuración de la base de datos:**
- Host: `localhost`
- Port: `5432`
- User: `postgres`
- Password: `postgres`
- Database: `devflow_studio`

**Nota:** Los datos se persisten en un volumen de Docker llamado `postgres_data`, por lo que no se perderán al detener el contenedor.

### Configuración de IA

#### Opción 1: cursor-agent (Recomendado para Cursor)

Instala `cursor-agent`, el CLI oficial de Cursor:

```bash
curl https://cursor.com/install -fsS | bash
```

Verifica la instalación:
```bash
which cursor-agent
```

**Ventajas:**
- ✅ No abre el IDE de Cursor
- ✅ Ejecuta comandos de IA directamente
- ✅ Funciona en modo batch/background

#### Opción 2: Claude API (Alternativa)

Para usar Claude API directamente (sin cursor-agent):

```bash
export CLAUDE_API_KEY="tu-api-key-de-anthropic"
```

**Ventajas:**
- ✅ No requiere cursor-agent
- ✅ Ejecución más rápida
- ✅ Funciona completamente en modo batch

**Nota:** El sistema usa `cursor-agent` por defecto si está instalado. Si no, usa Claude API si está configurada.

### Ejecutar en Desarrollo

```bash
# Backend
npm run dev:backend

# Frontend
npm run dev:frontend

# Worker
npm run dev:worker
```

## Licencia

MIT

