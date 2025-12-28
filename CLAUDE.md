# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevFlow Studio is an **AI-powered TDD-first software project management platform** that manages the complete software development lifecycle from ideation to deployment. It uses cursor-agent CLI or Claude API to execute AI-driven development tasks in a controlled, traceable manner through an 8-step structured workflow.

## Technology Stack

- **Frontend**: React + Vite + Tailwind CSS + React Router
- **Backend**: Express + TypeScript (MVC + Services + Repositories)
- **Worker**: Node.js + TypeScript (AI job executor)
- **Database**: PostgreSQL (primary) + AgentDB/SQLite (TDD context)
- **AI Integration**: cursor-agent CLI or Claude API via Anthropic SDK

## Monorepo Structure

This is an npm workspace monorepo:

```
packages/
├── backend/       # Express API server (Port 3001)
├── frontend/      # React SPA (Port 5173)
├── worker/        # AI Worker (polls for jobs)
└── shared/        # TypeScript types shared across packages
```

## Common Commands

### Development

```bash
# Install all dependencies
npm install

# Start services (in separate terminals)
npm run dev:backend    # Backend API on http://localhost:3001
npm run dev:frontend   # Frontend on http://localhost:5173
npm run dev:worker     # Worker (polls for AI jobs)

# Database setup (first time only)
./scripts/setup-db.sh  # Start PostgreSQL + run migrations

# Stop database
./scripts/stop-db.sh
```

### Testing

```bash
# Backend tests
npm run test --workspace=packages/backend

# Watch mode
npm run test:watch --workspace=packages/backend

# Coverage report
npm run test:coverage --workspace=packages/backend
```

### Type Checking & Linting

```bash
# Type check all packages
npm run type-check

# Lint all packages
npm run lint

# Format all files
npm run format
```

### Building

```bash
# Build all packages
npm run build

# Build specific package
npm run build --workspace=packages/backend
```

## Architecture Overview

### Backend Architecture (MVC + Service + Repository)

The backend follows a layered architecture:

```
backend/src/
├── server.ts                    # Express app entry point
├── config/
│   └── database.ts             # PostgreSQL connection pool
├── middleware/
│   ├── validation.ts           # Path validation, input sanitization
│   └── audit.ts                # Audit logging
├── routes/                     # Express routes (controllers)
│   ├── projects.ts
│   ├── coding-sessions.ts
│   ├── test-suites.ts
│   └── ... (20+ route files)
├── repositories/               # Data access layer
│   ├── projectRepository.ts
│   ├── codingSessionRepository.ts
│   └── ... (18 repositories)
├── services/                   # Business logic
│   ├── aiService.ts
│   ├── codingSessionService.ts  # (2250 lines - TDD core)
│   ├── projectStructureService.ts
│   ├── agentdb/                # AgentDB integration
│   └── tdd/                    # TDD-specific services
└── utils/
```

**Pattern**: Routes → Services → Repositories → Database

### Worker Architecture

The worker is a polling-based job executor that:

1. Polls `ai_jobs` table for pending jobs
2. Executes jobs using cursor-agent CLI or Claude API
3. Streams real-time output via `coding_session_events`
4. Parses AI responses (tests, code, errors)
5. Updates session state (progress, TDD cycle, status)

**Key Files**:
- `packages/worker/src/worker.ts` - Main worker loop (4000+ lines)
- `packages/worker/src/cli/cursor.ts` - cursor-agent wrapper
- `packages/worker/src/cli/claudeApi.ts` - Direct Anthropic API integration

## 8-Step Development Workflow

The system implements a structured workflow with strict traceability:

1. **PRD** (`prd_documents`) - Product Requirements Document
2. **User Stories** (`tasks` type='story') - Generated from PRD
3. **Design** (`user_flows`, `prototypes`) - User flows and UX
4. **RFC** (`rfc_documents`) - Technical architecture
5. **Breakdown** (`epics`, `tasks` type='task') - Epic/Task decomposition
6. **TDD Implementation** (`coding_sessions`, `test_suites`) - Core development
7. **QA** (`qa_sessions`, `integration_test_plans`) - Testing
8. **Release** (`releases`) - Deployment

**Traceability**: Each phase validates prerequisites using `traceabilityService.ts`

## TDD Implementation (Core Feature)

The system implements an **optimized TDD workflow** that reduces AI jobs from 30+ to ~6 per story.

### TDD Cycle Phases

```typescript
interface TDDCycle {
  test_index: number;              // Current batch starting index
  phase: 'green' | 'refactor';     // No RED phase (tests obviously fail)
  batch_size: number;              // 3 tests per batch (default)
  current_batch_tests: string[];   // Test names in current batch
  tests_passed: number;
  total_tests: number;             // Set once from parseGeneratedTests()
  all_tests: Array<{
    name: string;
    code: string;
    status: 'pending' | 'green' | 'refactored';
    attempts: number;
  }>;
  refactor_count: number;          // Strategic refactors (50%, 100%, stuck)
  stuck_count: number;             // Retry counter
  context_bundle?: string;         // Cached prompt (loaded once)
}
```

### TDD Flow Sequence

```
1. User creates coding session with test_strategy='tdd'
2. Backend creates test_generation_job (phase='test_generation')
3. Worker executes cursor-agent/Claude with test generation prompt
4. AI generates 5-8 focused tests (limited to prevent explosion)
5. Worker parses tests using parseGeneratedTests()
6. Worker calls initializeTDDCycle(sessionId, parsedTests)
7. GREEN Phase (Batch): Implement 3 tests at once
8. Execute tests, verify they pass
9. Strategic REFACTOR (at 50%, 100%, or when stuck)
10. Repeat batches until all tests complete
```

### TDD Optimizations

1. **No RED Phase**: Tests obviously fail before implementation - no verification needed
2. **Batch GREEN Phase**: Process 3 tests per AI job instead of 1
3. **Strategic Refactoring**: Refactor at 50%, 100%, stuck (not after every test)
4. **Context Bundle Caching**: Load PRD+RFC+Design once, reuse across batches
5. **Test Limit Enforcement**: Max 5-8 tests generated (prevents explosions)

**Performance**: 30+ AI jobs → ~6 jobs per story (83% reduction)

**Key Service**: `packages/backend/src/services/codingSessionService.ts` (2250 lines)

## AgentDB Integration

**Purpose**: Persistent SQLite-based context database for TDD sessions

- **Package**: `agentdb` (npm) - Local SQLite using sql.js (WebAssembly)
- **Location**: `{projectPath}/.agentdb/{projectName}.db`
- **Scope**: One DB per project (all sessions share same DB)

### AgentDB Schema

```sql
-- Tests table: Generated tests for TDD
CREATE TABLE tests (
  id, session_id, story_id, name, code, status, created_at
);

-- Code table: Implementation tracking
CREATE TABLE code (
  id, session_id, story_id, file_path, content,
  tests_passing, created_at, updated_at
);

-- Decisions table: AI reasoning log
CREATE TABLE decisions (
  id, session_id, story_id, action, reason,
  code_snippet, test_related, timestamp
);

-- TDD State table: Current TDD cycle state
CREATE TABLE tdd_state (
  session_id (PK), state_json (JSONB), updated_at
);

-- Traceability table: Full chain
CREATE TABLE traceability (
  session_id (PK), prd_id, story_id, design_id,
  rfc_id, epic_id, breakdown_tasks, created_at
);
```

**Managers** (in `packages/backend/src/services/agentdb/`):
- `AgentDBService.ts` - Core wrapper around agentdb SDK
- `AgentDBStateManager.ts` - TDD state persistence
- `AgentDBContextManager.ts` - Context retrieval
- `AgentDBRulesManager.ts` - Cursor rules generation
- `AgentDBTraceabilityStore.ts` - Traceability persistence

**Note**: sql.js requires explicit `db.save()` to persist to disk (called after every write)

## Project Structure Enforcement

The system enforces **MVC directory structure** across different tech stacks using `projectStructureService.ts`.

### Supported Tech Stacks

Node.js, Java/Spring Boot, Python (Django/Flask/FastAPI), Frontend (React/Vue/Angular), .NET, Go, Rust, Generic

### MVC Base Pattern

```
project/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── services/
│   │   ├── routes/
│   │   ├── middleware/
│   │   └── config/
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   └── utils/
│   └── tests/
├── shared/
│   ├── types/
│   ├── utils/
│   └── constants/
├── database/
│   ├── migrations/
│   ├── scripts/
│   └── seeds/
└── docs/
```

**Key Methods**:
- `detectStackType(techStack)` - Identify tech stack
- `getRecommendedStructure(techStack)` - Get MVC directories
- `enforceStructure(basePath, techStack)` - Create missing directories
- `getRecommendedPath(fileType, category, techStack)` - Get file path recommendation

## Database Schema

### Core Tables

- `projects` - Project metadata (name, base_path, tech_stack)
- `prd_documents` - Product requirements
- `tasks` - User stories (type='story') and breakdown tasks (type='task')
- `rfc_documents` - Technical architecture
- `epics` - Epic decomposition
- `coding_sessions` - TDD implementation sessions
- `coding_session_events` - Real-time events (SSE)
- `test_suites` - Generated tests
- `ai_jobs` - AI job queue
- `ai_job_events` - Job execution events

### Traceability Chain

```
Project → PRD → Stories → Design → RFC → Epics → Tasks → CodingSessions → Tests → Code
```

**Validation Service**: `traceabilityService.ts`

## AI Service Integration

### Cursor Agent (Preferred)

Install cursor-agent CLI:
```bash
curl https://cursor.com/install -fsS | bash
which cursor-agent  # Verify installation
```

**Usage**:
```typescript
command = 'cursor-agent';
args = ['--print', '--output-format', 'text', prompt];
spawn(command, args, { cwd: projectPath });
```

### Claude API (Alternative)

Set environment variable:
```bash
export CLAUDE_API_KEY="sk-ant-..."
```

**Usage** (in `packages/worker/src/cli/claudeApi.ts`):
```typescript
import Anthropic from '@anthropic-ai/sdk';
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: prompt }]
});
```

## Real-Time Updates (SSE)

The system uses Server-Sent Events for real-time coding session monitoring.

**Endpoint**: `GET /api/coding-sessions/stream/:sessionId`

**Event Types**:
- `connected` - Connection established
- `progress` - Progress percentage
- `tests_generated` - Tests completed
- `tdd_batch_completed` - Batch GREEN completed
- `tdd_cycle_progress` - TDD cycle update
- `test_execution_result` - Test results
- `completed` - Session finished
- `error` - Error occurred

## Critical Files Reference

### Backend (Most Important)

1. **TDD Core**: `packages/backend/src/services/codingSessionService.ts` (2250 lines)
   - `initializeTDDCycle()` - Initialize TDD with parsed tests
   - `executeBatchGREEN()` - Process 3 tests in batch
   - `executeREFACTOR()` - Strategic refactoring
   - `buildTestGenerationPrompt()` - Generate test prompt
   - `buildBatchGREENPhasePrompt()` - Lightweight batch prompt

2. **AI Service**: `packages/backend/src/services/aiService.ts`
   - `buildPromptBundle()` - Assembles PRD + Architecture + Stories + RFC context
   - `createAIJob()` - Creates AI job with bundled prompt

3. **Traceability**: `packages/backend/src/services/traceabilityService.ts`
   - `validateCanProceed()` - Validate prerequisites
   - `getStoryTraceability()` - Full chain for story

4. **Project Structure**: `packages/backend/src/services/projectStructureService.ts`
   - `enforceStructure()` - Create MVC directories
   - `getRecommendedPath()` - Get file path recommendation

### Worker

1. **Main Worker**: `packages/worker/src/worker.ts` (4000+ lines)
   - `pollForJobs()` - Main polling loop
   - `executeJob()` - Job execution dispatcher
   - `parseAndSaveTestSuites()` - Test parsing and AgentDB storage
   - `initializeTDDCycle()` - Initialize TDD cycle after test generation

2. **CLI Integration**:
   - `packages/worker/src/cli/cursor.ts` - cursor-agent wrapper
   - `packages/worker/src/cli/claudeApi.ts` - Direct Anthropic API

### Database

1. **Schema**: `database/migrations/009_new_flow_schema.sql` - 8-step workflow tables
2. **TDD Optimization**: `database/migrations/012_add_tdd_cycle.sql` - TDD cycle JSONB field

## Important Notes

### When Working with TDD Implementation

1. **Focus on `codingSessionService.ts`**: This is the heart of TDD implementation (2250 lines)
2. **TDD cycle is optimized**: Batch processing, no RED phase, strategic refactoring
3. **Tests are limited to 5-8**: Prevents AI from generating 50+ tests
4. **Context is cached**: PRD+RFC+Design loaded once, reused across batches
5. **AgentDB is local SQLite**: Not a cloud service, stored in `{project}/.agentdb/`

### When Working with Database

1. **Use repositories**: Never query database directly in routes/services
2. **Migration files**: Add new migrations to `database/migrations/`
3. **Run migrations**: Use `./scripts/setup-db.sh` or run manually via `database/scripts/run-migrations.js`

### When Working with Worker

1. **Worker polls for jobs**: Not event-driven, simple polling loop (every 5 seconds)
2. **Real-time updates via events**: Use `coding_session_events` table + SSE
3. **AgentDB saves after tests**: Worker calls `parseAndSaveTestSuites()` to store in AgentDB

### When Working with Project Structure

1. **Always use `projectStructureService`**: Don't hardcode paths
2. **MVC structure enforced**: Use `enforceStructure()` before file operations
3. **Tech stack detection**: Use `detectStackType()` to identify project type

### When Working with AI Prompts

1. **All prompts include PRD**: The "idea del proyecto" is always in context
2. **Use `buildPromptBundle()`**: Don't manually assemble context
3. **Test generation prompts**: Include tech stack, file structure, and test limits

## Database Configuration

PostgreSQL runs in Docker:

```yaml
# docker-compose.yml
Host: localhost
Port: 5432
User: postgres
Password: postgres
Database: devflow_studio
```

**Data Persistence**: Volume `postgres_data` (data persists after container stops)

## Environment Variables

### Backend (.env in packages/backend/)
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devflow_studio
PORT=3001
NODE_ENV=development
```

### Worker (.env in packages/worker/)
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devflow_studio
CLAUDE_API_KEY=sk-ant-...  # Optional (if not using cursor-agent)
```

## Common Development Patterns

### Creating a New Service

1. Create service in `packages/backend/src/services/`
2. Create repository in `packages/backend/src/repositories/`
3. Create routes in `packages/backend/src/routes/`
4. Register routes in `packages/backend/src/server.ts`

### Adding Database Tables

1. Create migration in `database/migrations/XXX_description.sql`
2. Run migrations: `./scripts/setup-db.sh` or manually
3. Add TypeScript types in `packages/shared/src/types/`
4. Create repository for data access

### Adding AI Jobs

1. Create job via `aiService.createAIJob()`
2. Worker polls and executes job
3. Worker updates job status via events
4. Frontend monitors via SSE endpoint

## Quick Start for New Claude Code Instances

1. **Understand the 8-step flow**: PRD → Stories → Design → RFC → Breakdown → TDD → QA → Release
2. **Focus on TDD core**: `codingSessionService.ts` is the heart of the system
3. **Check traceability**: Use `traceabilityService.ts` to validate prerequisites
4. **AgentDB is local**: Not a cloud service, stored in `{project}/.agentdb/`
5. **TDD cycle is optimized**: Batch processing saves 83% of AI jobs
6. **Worker polls for jobs**: Not event-driven, simple polling loop
7. **All prompts include PRD**: The project idea is always in context
8. **MVC structure enforced**: `projectStructureService.ts` creates directories

## Common Operations

### Create a Project
```
POST /api/projects/create
→ Creates directories, initializes PRD
```

### Generate User Stories
```
POST /api/user-stories/generate
→ Creates AI job to generate stories from PRD
```

### Start TDD Implementation
```
POST /api/coding-sessions/create
  { story_id, programmer_type, test_strategy: 'tdd' }
→ Creates test_generation_job
→ Worker generates tests
→ Initializes TDD cycle
→ Batch GREEN implementation
→ Strategic refactoring
→ Completion
```

### Monitor Progress
```
GET /api/coding-sessions/stream/:sessionId (SSE)
→ Real-time events: progress, tests_generated, tdd_batch_completed, etc.
```

## Debugging Tips

### Backend Debugging
```bash
# Watch mode with logs
npm run dev:watch --workspace=packages/backend

# Check database
docker compose exec postgres psql -U postgres -d devflow_studio
```

### Worker Debugging
```bash
# Watch mode with logs
npm run dev:watch --workspace=packages/worker

# Check AI jobs
SELECT * FROM ai_jobs WHERE status = 'pending' ORDER BY created_at DESC;
```

### Frontend Debugging
```bash
# Development mode with HMR
npm run dev --workspace=packages/frontend

# Check network tab for API calls
# Check console for SSE events
```

## Known Issues & Considerations

1. **AgentDB requires explicit save**: sql.js needs `db.save()` after writes
2. **Test limit enforcement**: AI prompts must specify max 5-8 tests
3. **Worker polling interval**: 5 seconds (configurable in worker.ts)
4. **SSE connection timeout**: Frontend reconnects after 30s idle
5. **Traceability warnings**: Some validations are warnings, not hard blocks

## Additional Documentation

- `TEST_SYSTEM_ARCHITECTURE.md` - Test system architecture
- `IMPLEMENTATION_SUMMARY.md` - Implementation summary
- `.cursor/plans/tdd_traditional_file_structure_c0b5f78f.plan.md` - TDD file structure plan
