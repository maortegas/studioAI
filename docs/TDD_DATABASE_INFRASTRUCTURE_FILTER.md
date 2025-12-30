# TDD Database Infrastructure Test Filter

## Overview

The worker now includes automatic validation to **filter out database infrastructure tests** during the test generation phase of TDD workflow. This ensures that generated tests focus on **business logic only**, not on database setup or configuration.

## Location

**File**: `packages/worker/src/worker.ts`
**Function**: `parseGeneratedTests()` - Filter #5 (lines 6147-6204)

## How It Works

### Detection Patterns

The filter detects infrastructure tests using regex patterns that match common infrastructure testing keywords:

#### ❌ Infrastructure Patterns (Filtered Out)

1. **Table/Schema Tests**
   - `test that users table exists`
   - `test that schema migration was created`
   - `test that email column has type varchar`

2. **Index Tests**
   - `test that email_idx index exists`
   - `test that index was created on email column`

3. **View/Trigger Tests**
   - `test that user_stats_view exists`
   - `test that trigger fires on insert`

4. **Connection/Pool Tests**
   - `test database connection pool configuration`
   - `test that database connects successfully`

5. **Constraint Tests**
   - `test that foreign key constraint exists`
   - `test that unique constraint was applied`

### Business Logic Patterns (Allowed)

The filter includes a **double-check mechanism** to allow tests that mention infrastructure keywords but are actually testing business logic:

#### ✅ Business Logic Patterns (Allowed)

1. **Validation Tests**
   - `test that createUser validates email format`
   - `test that email validation rejects invalid emails`

2. **Duplicate Detection**
   - `test that createUser rejects duplicate emails`
   - `test that duplicate username returns error`

3. **Business Rules**
   - `test that user cannot have two active sessions`
   - `test that business rule prevents negative balance`

4. **Authorization/Permissions**
   - `test that unauthorized user cannot access resource`
   - `test that permission check validates admin role`

5. **Workflows/State Transitions**
   - `test that workflow transitions from pending to active`
   - `test that state changes trigger notifications`

6. **Data Transformations**
   - `test that calculate function transforms input correctly`
   - `test that data is computed based on business rules`

7. **Mocked Database Calls** (Integration)
   - `test that repository is called with correct params (mocked)`
   - `test that database query is executed (with mock)`

## Examples

### ❌ WRONG - Will Be Filtered Out

```javascript
// Test: Verify users table has email column
it('should have email column in users table', () => {
  const result = db.query('SHOW COLUMNS FROM users');
  expect(result).toContainColumn('email');
});
```
**Reason**: Tests database schema structure, not business logic.

---

```javascript
// Test: Check that email_idx index exists
it('should have index on email column', () => {
  const indexes = db.query('SHOW INDEXES FROM users');
  expect(indexes).toContain('email_idx');
});
```
**Reason**: Tests database index creation, not business logic.

---

```javascript
// Test: Verify migration was applied
it('should have applied migration 001_create_users', () => {
  const migrations = db.query('SELECT * FROM schema_migrations');
  expect(migrations).toContain('001_create_users');
});
```
**Reason**: Tests database migration execution, not business logic.

### ✅ CORRECT - Business Logic Tests

```javascript
// Test: Validate email format (business logic)
it('should reject invalid email format', () => {
  const result = userService.createUser({ email: 'invalid-email' });
  expect(result.error).toBe('Invalid email format');
});
```
**Reason**: Tests email validation logic (business rule).

---

```javascript
// Test: Reject duplicate emails (business logic)
it('should reject duplicate email addresses', async () => {
  await userService.createUser({ email: 'test@example.com' });
  const result = await userService.createUser({ email: 'test@example.com' });
  expect(result.error).toBe('Email already exists');
});
```
**Reason**: Tests duplicate detection logic (business rule).

---

```javascript
// Test: Business rule - user cannot have two active sessions
it('should prevent user from having multiple active sessions', async () => {
  const user = await userService.createUser({ email: 'test@example.com' });
  await sessionService.createSession(user.id);

  const result = await sessionService.createSession(user.id);
  expect(result.error).toBe('User already has an active session');
});
```
**Reason**: Tests business logic rule about session limits.

## Filter Logic Flow

```
1. Parse test name and code
2. Check for infrastructure patterns (table, index, migration, etc.)
   ├─ NO infrastructure patterns → ✅ ALLOW test
   └─ HAS infrastructure patterns → Continue to step 3

3. Double-check: Does test also have business logic patterns?
   ├─ YES (validation, business rule, workflow, etc.) → ✅ ALLOW test
   └─ NO business logic patterns → ❌ FILTER OUT test
```

## Implementation Details

### Infrastructure Keywords Detected

```javascript
const infrastructurePatterns = [
  // Table/Schema
  /test.*(?:table|tables).*(?:exist|created|has|contains)/i,
  /test.*(?:schema|migration).*(?:created|applied|run)/i,
  /test.*(?:column|field).*(?:exist|has|type|created)/i,

  // Index
  /test.*(?:index|indices|indexes).*(?:exist|created|has)/i,

  // View/Trigger
  /test.*(?:view|views).*(?:exist|created|materialized)/i,
  /test.*(?:trigger|triggers).*(?:exist|created|fire)/i,

  // Connection/Pool
  /test.*(?:connection|database).*(?:pool|config|configuration|setup)/i,
  /test.*(?:connect|disconnect).*(?:database|pool)/i,

  // Constraint
  /test.*(?:constraint|foreign key|unique constraint).*(?:exist|created|applied)/i,

  // Direct checks
  /(?:expect|assert).*(?:table|column|index|view|trigger).*(?:toexist|exist|defined)/i,
  /(?:check|verify).*(?:database|schema).*(?:structure|setup)/i
];
```

### Business Logic Keywords Detected

```javascript
const businessLogicPatterns = [
  /validate/i,                          // Validation logic
  /reject.*duplicate/i,                 // Duplicate detection
  /(?:business|domain).*(?:rule|logic)/i, // Business/domain rules
  /authorization|permission|access/i,   // Auth/permissions
  /workflow|state.*transition/i,        // State management
  /transform|calculate|compute/i,       // Data transformations
  /mock.*(?:repository|database|query)/i // Mocked DB calls
];
```

## Console Warnings

When a test is filtered out, the worker logs:

```
[Worker] ⚠️  FILTERED: Database infrastructure test detected (not business logic): "test that users table exists"
[Worker] Tests should focus on business logic (validations, rules, workflows), not infrastructure (tables, indexes, migrations)
```

## Impact

- **Before**: AI might generate 2-3 infrastructure tests per story (e.g., "test table exists", "test index created")
- **After**: These tests are automatically filtered out during parsing
- **Result**: Only business logic tests are saved to AgentDB and executed in TDD cycle

## Integration with TDD Flow

This filter is applied **after test generation** and **before TDD cycle initialization**:

```
1. AI generates tests (test_generation job)
2. Worker receives AI output
3. parseGeneratedTests() extracts tests
   └─ Filter #5 removes infrastructure tests ⬅️ NEW
4. Valid business logic tests are saved to AgentDB
5. TDD cycle begins with GREEN phase
```

## Testing the Filter

To manually test if a test would be filtered:

```javascript
// Example test name: "test that users table has email column"
// Example test code: "expect(db.schema).toHaveColumn('email')"

const testNameLower = "test that users table has email column".toLowerCase();
const testCodeLower = "expect(db.schema).toHaveColumn('email')".toLowerCase();

// Check infrastructure patterns
const hasInfra = /test.*(?:table|tables).*(?:exist|created|has|contains)/i.test(testNameLower);
// Result: true (matches infrastructure pattern)

// Check business logic patterns
const hasBizLogic = /validate/i.test(testNameLower) || /validate/i.test(testCodeLower);
// Result: false (no business logic keywords)

// Final decision: FILTER OUT (has infra pattern, no biz logic)
```

## Configuration

Currently, the filter is **always enabled** and cannot be disabled. This is intentional to enforce business logic focus in TDD.

If you need to adjust the patterns, edit:
- **File**: `packages/worker/src/worker.ts`
- **Function**: `parseGeneratedTests()`
- **Section**: Filter #5 (lines 6147-6204)

## Related Documentation

- `CLAUDE.md` - TDD Test Scope Rules (lines 203-234)
- `packages/backend/src/services/codingSessionService.ts` - Test generation prompt (lines 763-792)
