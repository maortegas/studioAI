# Estructura Propuesta para Nuevo Flujo de Desarrollo

## 📁 Estructura de Carpetas Propuesta

```
StudioIA/
├── management/                          # Gestión del ciclo de vida
│   ├── prd/                            # Paso 1: PRD Management
│   │   ├── templates/                  # Plantillas de PRD
│   │   ├── validators/                 # Validadores de PRD
│   │   └── schemas/                    # Schemas de PRD (JSON Schema)
│   │
│   ├── user-stories/                   # Paso 2: User Stories
│   │   ├── generators/                 # Generadores de historias desde PRD
│   │   ├── parsers/                    # Parsers para JSON/MD importados
│   │   └── validators/                 # Validadores de formato y AC
│   │
│   ├── design/                         # Paso 3: Design & UX Discovery
│   │   ├── user-flows/                 # User flows (Mermaid/text)
│   │   ├── prototypes/                 # Análisis de prototipos (imágenes)
│   │   └── analyzers/                  # Analizadores de imágenes/screenshots
│   │
│   ├── rfc/                            # Paso 4: RFC / Diseño Técnico
│   │   ├── generators/                 # Generadores de RFC desde PRD+Stories
│   │   ├── templates/                  # Plantillas de RFC
│   │   ├── diagrams/                   # Diagramas (Mermaid, sequence, etc.)
│   │   ├── contracts/                  # Contratos API (OpenAPI/Swagger)
│   │   └── schemas/                    # Modelos de datos (SQL/NoSQL)
│   │
│   ├── breakdown/                      # Paso 5: Breakdown & Estimación
│   │   ├── epic-generators/            # Generadores de épicas
│   │   ├── task-breakdown/             # Descomposición en tasks
│   │   ├── estimation/                 # Estimación de story points
│   │   └── validators/                 # Validadores (max 2-3 días por task)
│   │
│   ├── development/                    # Paso 6: Desarrollo & CI Local
│   │   ├── branch-strategy/            # Estrategia de branches feature/*
│   │   ├── docker/                     # Dockerfiles y docker-compose
│   │   ├── ci-config/                  # Configuración CI
│   │   └── local-env/                  # Entorno local
│   │
│   ├── qa/                             # Paso 7: QA & Testing (Placeholder)
│   │   └── .gitkeep                    # Por implementar
│   │
│   └── release/                        # Paso 8: Lanzamiento (Placeholder)
│       └── .gitkeep                    # Por implementar
│
├── docs/                               # Documentación generada
│   ├── prd/                            # PRDs por proyecto
│   │   └── {project-id}/
│   │       ├── vision.md
│   │       └── personas.md
│   │
│   ├── user-stories/                   # User stories generadas
│   │   └── {project-id}/
│   │       ├── stories.json
│   │       └── stories.md
│   │
│   ├── design/                         # Design artifacts
│   │   └── {project-id}/
│   │       ├── user-flows/
│   │       └── prototypes/
│   │
│   └── rfc/                            # RFCs técnicos
│       └── {project-id}/
│           ├── rfc-{id}.md
│           ├── api-contracts/
│           ├── database-schemas/
│           └── diagrams/
│
├── packages/                           # Paquetes existentes (mantener)
│   ├── backend/
│   ├── frontend/
│   ├── shared/
│   └── worker/
│
├── apps/                               # Aplicaciones (monorepo)
│   ├── api-gateway/
│   ├── shop-web/
│   └── ...
│
├── database/
│   ├── migrations/
│   └── schemas/                        # Nuevo: Schemas generados desde RFC
│
└── infra/                              # Infraestructura
    ├── docker/
    │   ├── Dockerfile.api
    │   ├── Dockerfile.frontend
    │   └── docker-compose.yml
    └── ci/
        └── .github/
            └── workflows/
```

## 🔄 Flujo de Datos Propuesto

```
PRD (Manual)
    ↓
User Stories (IA: Auto-generación desde PRD)
    ↓
Design & UX (IA: User Flows + Análisis Prototipos)
    ↓
RFC/System Design (IA: PRD + Stories → RFC completo)
    ↓
Breakdown & Estimación (IA: RFC → Épicas → Tasks)
    ↓
Development (Feature branches + Docker)
    ↓
QA & Testing (Por implementar)
    ↓
Release & Monitoring (Por implementar)
```

## 📊 Base de Datos - Nuevas Tablas Propuestas

### Tablas para Nuevo Flujo

```sql
-- Paso 1: PRD
CREATE TABLE prd_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    vision TEXT NOT NULL,
    personas JSONB NOT NULL,  -- Array de personas con roles, necesidades, etc.
    status VARCHAR(50) DEFAULT 'draft',  -- draft, validated, approved
    validated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Paso 2: User Stories (extender tasks existente o crear nueva)
-- Usar tabla tasks existente pero agregar campos:
ALTER TABLE tasks ADD COLUMN acceptance_criteria JSONB;  -- Array de AC
ALTER TABLE tasks ADD COLUMN generated_from_prd BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN story_points INTEGER;

-- Paso 3: Design & UX
CREATE TABLE user_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    flow_name VARCHAR(255) NOT NULL,
    flow_diagram TEXT,  -- Mermaid o texto estructurado
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE prototypes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    file_path VARCHAR(500),
    analysis_result JSONB,  -- Resultado del análisis IA
    uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Paso 4: RFC / System Design
CREATE TABLE rfc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,  -- Markdown del RFC
    architecture_type VARCHAR(50),  -- monorepo, polyrepo, microservices, etc.
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE api_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc_id UUID REFERENCES rfc_documents(id),
    contract_type VARCHAR(50),  -- openapi, swagger, graphql
    contract_content JSONB,
    file_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE database_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc_id UUID REFERENCES rfc_documents(id),
    schema_type VARCHAR(50),  -- sql, nosql, etc.
    schema_content TEXT,
    migrations_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Paso 5: Breakdown & Estimación
CREATE TABLE epics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    rfc_id UUID REFERENCES rfc_documents(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    story_points INTEGER,
    status VARCHAR(50) DEFAULT 'planned',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Usar tabla tasks existente pero agregar:
ALTER TABLE tasks ADD COLUMN epic_id UUID REFERENCES epics(id);
ALTER TABLE tasks ADD COLUMN estimated_days INTEGER;  -- Max 2-3 días
ALTER TABLE tasks ADD COLUMN breakdown_order INTEGER;  -- Orden de descomposición
```

## 🛠️ Servicios Backend Propuestos

### Nuevos Servicios

```
packages/backend/src/services/
├── prdService.ts              # Validación y gestión de PRD
├── userStoryGeneratorService.ts  # Generación automática de historias
├── designAnalyzerService.ts   # Análisis de prototipos y user flows
├── rfcGeneratorService.ts     # Generación de RFC desde PRD+Stories
├── breakdownService.ts        # Breakdown en épicas y tasks
└── estimationService.ts       # Estimación de story points
```

## 📝 Próximos Pasos

1. ✅ Backup realizado
2. ⏳ Crear estructura de carpetas
3. ⏳ Crear migraciones de base de datos
4. ⏳ Implementar servicios para Paso 1 (PRD)
5. ⏳ Implementar generador de User Stories (Paso 2)
6. ⏳ Continuar con pasos siguientes...
