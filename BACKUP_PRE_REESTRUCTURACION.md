# Backup Pre-Reestructuración - Estado Actual del Sistema

**Fecha**: 2025-12-21 17:58:23 -03
**Rama Actual**: newFlow
**Último Commit**: 8687fb2 - Merge pull request #3 from maortegas/restructuracionCarpetas

## 📋 Estado del Sistema Actual

### Estructura de Carpetas Actual
```
StudioIA/
├── database/
│   ├── migrations/          # Migraciones de base de datos
│   └── scripts/             # Scripts de inicialización
├── packages/
│   ├── backend/             # API Express.js
│   ├── frontend/            # React + Vite
│   ├── shared/              # Tipos compartidos
│   └── worker/              # Worker para procesamiento IA
├── scripts/                 # Scripts de utilidad
└── docs/                    # Documentación (si existe)
```

### Esquema de Base de Datos Actual

Tablas principales identificadas:
- projects
- tasks (user stories)
- stages
- artifacts
- coding_sessions
- coding_session_events
- ai_jobs
- qa_sessions
- test_suites
- test_executions
- test_plans
- test_plan_items
- releases

### Flujo Actual

1. **Idea Stage**: PRD manual
2. **Design Stage**: Architecture upload/generation
3. **Stories Stage**: User stories creation (manual/AI-assisted)
4. **Roadmap Stage**: Roadmap generation
5. **Implementation Stage**: Coding sessions con estrategias de testing (TDD/after/none)
6. **QA Stage**: Multiple test types (unit, integration, e2e, contract, load)
7. **Release Stage**: Release management

### Cambios Recientes Importantes

1. ✅ Estructura de monorepo implementada (apps/, packages/, tools/, infra/)
2. ✅ ProjectStructureService para generar estructuras según tech stack
3. ✅ Estrategias de testing configurables (TDD, after, none)
4. ✅ Sistema QA extendido con múltiples tipos de pruebas
5. ✅ Auto-detección de artifacts en filesystem

## 🎯 Nuevo Flujo Propuesto (8 Pasos)

1. **PRD (Manual)** - Visión y User Personas
2. **User Stories (Automatizado/Híbrido)** - Generación automática desde PRD
3. **Design & UX Discovery** - User Flows y Prototipos
4. **RFC / Diseño Técnico** - System Design completo
5. **Breakdown & Estimación** - Épicas y Tasks granulares
6. **Ciclo de Desarrollo & CI Local** - Feature branches + Docker
7. **QA & Testing** - Placeholder (a implementar)
8. **Lanzamiento y Monitoreo** - Placeholder (a implementar)

## ⚠️ Puntos de Atención

- El sistema actual tiene un flujo funcional que debe ser migrado
- Las tablas de base de datos pueden necesitar ajustes
- La estructura de archivos cambiará significativamente
- Los servicios existentes necesitarán adaptación

## 📦 Backup Realizado

- ✅ Estado de Git documentado
- ✅ Migraciones de base de datos identificadas
- ✅ Estructura de carpetas documentada
- ✅ Flujo actual documentado
