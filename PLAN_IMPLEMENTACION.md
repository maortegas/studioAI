# Plan de Implementación - Nuevo Flujo de Desarrollo

## ✅ Fase 0: Backup Completado

- ✅ Estado de Git documentado (commit 8687fb2, rama newFlow)
- ✅ Migraciones de base de datos respaldadas (8 archivos SQL)
- ✅ Estructura actual documentada
- ✅ Tag de backup creado: `backup-pre-reestructuracion`

## 📋 Fase 1: Estructura de Carpetas y Base de Datos

### 1.1 Crear Estructura de Carpetas
```bash
management/
├── prd/
├── user-stories/
├── design/
├── rfc/
├── breakdown/
├── development/
├── qa/
└── release/

docs/
├── prd/
├── user-stories/
├── design/
└── rfc/
```

### 1.2 Migración de Base de Datos
Crear migración `009_new_flow_schema.sql` con:
- Tabla `prd_documents`
- Tablas `user_flows`, `prototypes`
- Tablas `rfc_documents`, `api_contracts`, `database_schemas`
- Tabla `epics`
- Extender tabla `tasks` con nuevos campos

## 📋 Fase 2: Servicios Backend

### 2.1 PRD Service (Paso 1)
- Validación de Vision y Personas
- Almacenamiento en `/docs/prd/{project-id}/`
- Validator antes de avanzar al siguiente paso

### 2.2 User Story Generator (Paso 2)
- Generación automática desde PRD
- Formato: "Yo como [usuario], quiero [acción], para [beneficio]"
- Incluir Criterios de Aceptación
- Soporte para importar JSON/MD

### 2.3 Design Analyzer (Paso 3)
- Generación de User Flows (Mermaid)
- Análisis de prototipos (imágenes)

### 2.4 RFC Generator (Paso 4)
- Generación desde PRD + Stories
- Diagramas de secuencia (Mermaid)
- Contratos API (OpenAPI)
- Modelado de datos (SQL/NoSQL)

### 2.5 Breakdown Service (Paso 5)
- Descomposición en Épicas
- Tasks granulares (max 2-3 días)
- Estimación de Story Points

### 2.6 Development Service (Paso 6)
- Gestión de feature branches
- Docker setup
- CI configuration

## 📋 Fase 3: Frontend

### 3.1 Componentes para Cada Paso
- PRDEditor (ya existe, adaptar)
- UserStoriesGenerator (nuevo)
- DesignAnalyzer (nuevo)
- RFCGenerator (nuevo)
- BreakdownViewer (nuevo)
- DevelopmentDashboard (nuevo)

## 🎯 Prioridad de Implementación

1. **Alta**: Paso 1 (PRD) - Base para todo
2. **Alta**: Paso 2 (User Stories) - Depende de PRD
3. **Media**: Paso 4 (RFC) - Depende de PRD + Stories
4. **Media**: Paso 5 (Breakdown) - Depende de RFC
5. **Baja**: Paso 3 (Design) - Puede ser paralelo
6. **Baja**: Paso 6 (Development) - Infraestructura
7. **Placeholder**: Pasos 7 y 8 (QA y Release)

## 🚀 Próximo Paso

**Esperando confirmación del usuario para proceder con:**
1. Crear estructura de carpetas
2. Crear migración de base de datos
3. Implementar servicio PRD (Paso 1)
