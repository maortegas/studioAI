# Test Strategy Recommendations by Feature Type

**Date**: December 31, 2025
**Purpose**: Guide for selecting the appropriate `test_strategy` when creating coding sessions

---

## 📋 Available Test Strategies

| Strategy | Description | When Tests Run | Use Cases |
|----------|-------------|----------------|-----------|
| `'tdd'` | **Test-Driven Development** | Tests generated FIRST, then implementation | Business logic, APIs, services |
| `'after'` | **Implementation First** | Implementation FIRST, then tests | Complex UI, integrations |
| `'none'` | **No Tests** | No tests generated | Type definitions, configuration |

---

## 🎯 Recommendations by Feature Type

### ✅ **ALWAYS Use `'tdd'`** (Recommended for 80% of cases)

#### Backend Services & Business Logic
- **Services** (UserService, TaskService, etc.)
- **Repositories** (Data access layer)
- **Controllers** (API endpoints)
- **Utilities** (Helper functions)
- **Validators** (Input validation logic)
- **Middleware** (Authentication, authorization)

**Why TDD?**
- ✅ Catches bugs early
- ✅ Forces clear API design
- ✅ Provides regression protection
- ✅ Documents expected behavior
- ✅ Ensures code quality

**Example Tasks**:
```
✅ "Create User Service with CRUD operations" → TDD
✅ "Implement authentication middleware" → TDD
✅ "Add email validation utility" → TDD
✅ "Create Employee Repository" → TDD
```

---

#### API Endpoints & Routes
- **REST APIs** (GET, POST, PUT, DELETE)
- **GraphQL Resolvers**
- **WebSocket handlers**

**Why TDD?**
- ✅ Validates request/response contracts
- ✅ Tests error handling
- ✅ Ensures proper status codes
- ✅ Documents API behavior

**Example Tasks**:
```
✅ "Create /api/employees endpoint" → TDD
✅ "Add pagination to list endpoint" → TDD
✅ "Implement soft delete for Employee" → TDD
```

---

#### Data Models & Database Operations
- **Database schemas** (when testing business rules)
- **Migrations** (when validating schema constraints)
- **Model validations**
- **Query builders**

**Why TDD?**
- ✅ Validates business rules (uniqueness, relationships)
- ✅ Tests constraints and indexes
- ✅ Ensures data integrity

**Example Tasks**:
```
✅ "Add unique constraint to email field" → TDD
✅ "Create Employee model with validations" → TDD
✅ "Implement soft delete logic" → TDD
```

---

### ⚡ **Use `'after'`** (For complex implementations)

#### Complex Frontend Components
- **Complex forms** with multi-step flows
- **Data visualization** components
- **Rich text editors**
- **Complex state machines**

**Why After?**
- ⚡ Implementation complexity requires exploration
- ⚡ UI behavior evolves during development
- ⚡ Easier to test after seeing implementation
- ⚡ Tests validate final behavior

**Example Tasks**:
```
⚡ "Create multi-step employee onboarding form" → AFTER
⚡ "Implement employee dashboard with charts" → AFTER
⚡ "Build rich text editor for notes" → AFTER
```

---

#### Integration Points
- **Third-party API integrations**
- **Payment gateway integration**
- **Email service integration**
- **External service wrappers**

**Why After?**
- ⚡ Implementation may need adaptation
- ⚡ External dependencies affect design
- ⚡ Easier to mock after understanding integration

**Example Tasks**:
```
⚡ "Integrate Stripe payment processing" → AFTER
⚡ "Connect to SendGrid email API" → AFTER
⚡ "Implement OAuth with Google" → AFTER
```

---

### 🚫 **Use `'none'`** (No tests needed)

#### Type Definitions & Interfaces
- **TypeScript interfaces**
- **Type definitions**
- **Shared types**
- **API contracts** (types only)

**Why None?**
- 🚫 No executable logic to test
- 🚫 TypeScript provides compile-time checking
- 🚫 Types are validated by usage, not tests

**Example Tasks**:
```
🚫 "Define Employee TypeScript interfaces" → NONE
🚫 "Create shared API types" → NONE
🚫 "Add CreateEmployeeRequest type" → NONE
🚫 "Define pagination types" → NONE
```

---

#### Configuration Files
- **Environment configs** (.env templates)
- **Build configurations** (webpack, vite)
- **Linter configs** (.eslintrc)
- **Docker files**
- **CI/CD configs**

**Why None?**
- 🚫 Configuration is validated at runtime
- 🚫 No logic to unit test
- 🚫 Integration tests cover config validation

**Example Tasks**:
```
🚫 "Create .env.example template" → NONE
🚫 "Configure ESLint rules" → NONE
🚫 "Setup Dockerfile" → NONE
🚫 "Add GitHub Actions workflow" → NONE
```

---

#### Infrastructure Code
- **Database setup scripts**
- **Seed data**
- **Migration scripts** (schema only, no logic)
- **Initial project structure**

**Why None?**
- 🚫 One-time setup tasks
- 🚫 Verified by manual execution
- 🚫 No business logic to test

**Example Tasks**:
```
🚫 "Create initial database schema" → NONE
🚫 "Add seed data for development" → NONE
🚫 "Setup project folder structure" → NONE
🚫 "Install dependencies" → NONE
```

---

#### Documentation
- **README files**
- **API documentation**
- **Architecture diagrams**
- **Comments and JSDoc**

**Why None?**
- 🚫 Not executable code
- 🚫 No logic to test

**Example Tasks**:
```
🚫 "Write API documentation" → NONE
🚫 "Create README for project" → NONE
🚫 "Add JSDoc comments to Service" → NONE
```

---

## 🔍 Decision Tree

```
┌─────────────────────────────────┐
│   Does this task create         │
│   executable business logic?    │
└────────────┬────────────────────┘
             │
       ┌─────┴─────┐
       │           │
      YES         NO → Use 'none'
       │
       ▼
┌─────────────────────────────────┐
│   Is the implementation          │
│   straightforward/well-defined?  │
└────────────┬────────────────────┘
             │
       ┌─────┴─────┐
       │           │
      YES         NO
       │           │
       ▼           ▼
   Use 'tdd'   Use 'after'
```

---

## 📊 Quick Reference Matrix

| Feature Category | Recommended Strategy | Confidence |
|------------------|----------------------|------------|
| **Backend Services** | `'tdd'` | ⭐⭐⭐⭐⭐ |
| **API Endpoints** | `'tdd'` | ⭐⭐⭐⭐⭐ |
| **Data Models (with logic)** | `'tdd'` | ⭐⭐⭐⭐⭐ |
| **Utilities & Helpers** | `'tdd'` | ⭐⭐⭐⭐⭐ |
| **Validators** | `'tdd'` | ⭐⭐⭐⭐⭐ |
| **Simple React Components** | `'tdd'` | ⭐⭐⭐⭐ |
| **Complex UI Components** | `'after'` | ⭐⭐⭐⭐ |
| **Third-party Integrations** | `'after'` | ⭐⭐⭐⭐ |
| **TypeScript Interfaces** | `'none'` | ⭐⭐⭐⭐⭐ |
| **Configuration Files** | `'none'` | ⭐⭐⭐⭐⭐ |
| **Documentation** | `'none'` | ⭐⭐⭐⭐⭐ |
| **Infrastructure Scripts** | `'none'` | ⭐⭐⭐⭐⭐ |

---

## 💡 Detection Patterns (for auto-detection)

### Patterns that Suggest `'none'`

```typescript
const NO_TEST_PATTERNS = [
  // Type definitions
  /define.*types?/i,
  /create.*types?/i,
  /shared.*types?/i,
  /typescript.*interface/i,
  /type.*definition/i,

  // Configuration
  /configure/i,
  /setup.*config/i,
  /\.env/i,
  /docker/i,
  /ci\/cd/i,

  // Documentation
  /write.*documentation/i,
  /create.*readme/i,
  /add.*comments/i,

  // Infrastructure
  /seed.*data/i,
  /initial.*schema/i,
  /project.*structure/i,
];
```

### Patterns that Suggest `'after'`

```typescript
const AFTER_PATTERNS = [
  // Complex UI
  /complex.*form/i,
  /multi-step/i,
  /wizard/i,
  /rich.*editor/i,
  /chart|graph|visualization/i,

  // Integrations
  /integrate.*with/i,
  /connect.*to/i,
  /third[- ]party/i,
  /payment.*gateway/i,
  /oauth/i,
];
```

### Default to `'tdd'` for everything else

---

## 🎯 Real-World Examples

### Employee Management System

| Task | Strategy | Rationale |
|------|----------|-----------|
| "Create Employee Database Model" | `'tdd'` | Has business rules (soft delete, indexes) |
| "Create Shared Employee Types" | `'none'` | Just TypeScript interfaces |
| "Create Employee Service with CRUD" | `'tdd'` | Core business logic |
| "Create Employee API Endpoints" | `'tdd'` | REST API with validation |
| "Create Employee List UI Component" | `'tdd'` | Simple component with clear behavior |
| "Create Employee Dashboard with Charts" | `'after'` | Complex visualization component |
| "Setup Employee Module Structure" | `'none'` | Just folder creation |

---

## 📝 Best Practices

### ✅ DO:
- Use `'tdd'` as the **default** for any business logic
- Use `'none'` for purely structural/declarative tasks
- Use `'after'` when implementation complexity justifies it
- Document which strategy was chosen and why

### ❌ DON'T:
- Use `'none'` to skip tests on complex business logic
- Use `'after'` out of laziness (TDD is preferred)
- Forget to validate that `'none'` tasks actually don't need tests
- Mix strategies without clear reasoning

---

## 🔧 Implementation Guidelines

### When Creating a Coding Session

```typescript
// Example API call
POST /api/coding-sessions/create
{
  "project_id": "...",
  "story_id": "...",
  "programmer_type": "backend",
  "test_strategy": "tdd"  // or "after" or "none"
}
```

### Auto-Detection Function (Recommended)

```typescript
function recommendTestStrategy(task: Task): TestStrategy {
  const text = `${task.title} ${task.description}`.toLowerCase();

  // Check for 'none' patterns first
  if (NO_TEST_PATTERNS.some(pattern => pattern.test(text))) {
    return 'none';
  }

  // Check for 'after' patterns
  if (AFTER_PATTERNS.some(pattern => pattern.test(text))) {
    return 'after';
  }

  // Default to TDD
  return 'tdd';
}
```

---

## 📚 Additional Resources

- **TDD Optimization**: See `docs/TDD_OPTIMIZATION_SUMMARY.md`
- **Test System Architecture**: See `TEST_SYSTEM_ARCHITECTURE.md`
- **Hybrid Retry System**: See `HYBRID_RETRY_MIGRATION_GUIDE.md`

---

## ⚠️ Important Notes

1. **TDD is the default** - When in doubt, use `'tdd'`
2. **`'none'` should be rare** - Only for truly test-less tasks
3. **`'after'` is for complexity** - Not for avoiding TDD
4. **Document exceptions** - If using non-default strategy, explain why
5. **Review edge cases** - Some tasks may need manual decision

---

**Summary**: Use `'tdd'` for 80% of tasks, `'after'` for 15%, and `'none'` for 5%.

🎯 **When in doubt → Use `'tdd'`**
