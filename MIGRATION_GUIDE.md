# TDD Optimization Migration Guide

## Overview

This guide helps you migrate from the old TDD implementation (RED-GREEN-REFACTOR per test) to the optimized version (batch GREEN + strategic REFACTOR).

## Performance Improvement

- **Before:** 30+ AI jobs per story (~30-60 minutes)
- **After:** ~6 AI jobs per story (~5-10 minutes)
- **Speedup:** 6x faster

## Step 1: Apply Database Migration

The database schema needs to be updated to remove the `tdd_red` status.

### Option A: Using npm script (Recommended)
```bash
cd /Users/mortegas/Documents/StudioIA/database
npm run migrate
```

### Option B: Manual SQL
```bash
cd /Users/mortegas/Documents/StudioIA
PGPASSWORD=postgres psql -h localhost -U postgres -d devflow_studio -f database/migrations/012_add_tdd_cycle.sql
```

### Option C: Using the apply script
```bash
cd /Users/mortegas/Documents/StudioIA
node database/scripts/apply_012.js
```

## Step 2: Handle Existing TDD Sessions

Check if there are any sessions currently in `tdd_red` status:

```sql
SELECT id, status, tdd_cycle->>'phase' as phase, tdd_cycle->>'test_index' as test_index
FROM coding_sessions
WHERE status = 'tdd_red';
```

### If sessions exist:

**Option A: Complete them manually**
```sql
UPDATE coding_sessions
SET status = 'completed', completed_at = NOW()
WHERE status = 'tdd_red';
```

**Option B: Migrate them to new flow**
```sql
UPDATE coding_sessions
SET status = 'tdd_green',
    tdd_cycle = jsonb_set(tdd_cycle, '{phase}', '"green"')
WHERE status = 'tdd_red';
```

## Step 3: Restart Services

After applying the migration, restart all services:

```bash
# Terminal 1: Backend
cd /Users/mortegas/Documents/StudioIA/packages/backend
npm run dev

# Terminal 2: Worker
cd /Users/mortegas/Documents/StudioIA/packages/worker
npm run dev

# Terminal 3: Frontend
cd /Users/mortegas/Documents/StudioIA/packages/frontend
npm run dev
```

## Step 4: Test the Optimized Flow

Create a test story with 2-3 acceptance criteria:

```bash
cd /Users/mortegas/Documents/StudioIA
./scripts/test-tdd-from-app.sh
```

### Expected Behavior:

1. **Test Generation Phase:**
   - Generates 5-8 tests (not 50!)
   - Creates 1 AI job

2. **GREEN Phase (Batch 1):**
   - Implements first 3 tests together
   - Creates 1 AI job
   - Status: `tdd_green`

3. **GREEN Phase (Batch 2):**
   - Implements next 3 tests together
   - Creates 1 AI job
   - Status: `tdd_green`

4. **Strategic REFACTOR (Midpoint):**
   - Triggered at ~50% progress
   - Creates 1 AI job
   - Status: `tdd_refactor`

5. **GREEN Phase (Batch 3):**
   - Implements remaining tests
   - Creates 1 AI job
   - Status: `tdd_green`

6. **Strategic REFACTOR (Final):**
   - Triggered at 100% completion
   - Creates 1 AI job
   - Status: `tdd_refactor`

7. **Completion:**
   - Status: `completed`
   - All tests passing

### Total: ~6 AI jobs (vs 30+ before)

## Step 5: Monitor Performance

Check job counts for a session:

```sql
SELECT 
  cs.id,
  cs.status,
  cs.tdd_cycle->>'phase' as current_phase,
  cs.tdd_cycle->>'test_index' as test_index,
  cs.tdd_cycle->>'total_tests' as total_tests,
  COUNT(aj.id) as total_jobs
FROM coding_sessions cs
LEFT JOIN ai_jobs aj ON aj.args->>'coding_session_id' = cs.id::text
WHERE cs.id = 'YOUR_SESSION_ID'
GROUP BY cs.id;
```

## Troubleshooting

### Issue: Migration fails with "constraint already exists"

**Solution:** Drop the constraint first:
```sql
ALTER TABLE coding_sessions DROP CONSTRAINT IF EXISTS coding_sessions_status_check;
```
Then re-run the migration.

### Issue: Worker still creating RED phase jobs

**Solution:** 
1. Check worker is using latest code: `git pull`
2. Restart worker: `npm run dev`
3. Clear any cached modules: `rm -rf node_modules/.cache`

### Issue: Tests still generating 50+ tests

**Solution:**
1. Check `buildTestGenerationPrompt()` has the 5-8 limit
2. Check `parseGeneratedTests()` has `MAX_TESTS = 15`
3. Restart backend service

### Issue: Refactoring after every batch

**Solution:**
1. Check `shouldRefactor()` logic in `codingSessionService.ts`
2. Verify `refactor_count` is being tracked correctly
3. Check worker is calling `advanceToNextBatch()` not `advanceToNextTest()`

## Rollback Instructions

If you need to revert to the old flow:

```bash
# 1. Checkout previous commit
git log --oneline  # Find commit before optimization
git checkout <previous-commit>

# 2. Revert database migration
ALTER TABLE coding_sessions DROP CONSTRAINT IF EXISTS coding_sessions_status_check;
ALTER TABLE coding_sessions 
  ADD CONSTRAINT coding_sessions_status_check 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused', 'reviewing', 'generating_tests', 'tests_generated', 'tdd_red', 'tdd_green', 'tdd_refactor'));

# 3. Restart services
# (same as Step 3 above)
```

## Configuration Options

### Adjust Batch Size

In `codingSessionService.ts`, `initializeTDDCycle()`:

```typescript
const batchSize = 3; // Change to 4 or 5 for larger batches
```

**Recommendations:**
- `batchSize = 2`: For complex tests
- `batchSize = 3`: Default (balanced)
- `batchSize = 4-5`: For simple tests

### Adjust Test Generation Limit

In `codingSessionService.ts`, `buildTestGenerationPrompt()`:

```typescript
lines.push(`- Generate **MAXIMUM 5-8 focused tests**\n`);
// Change to 8-12 if needed
```

### Adjust Refactor Triggers

In `codingSessionService.ts`, `shouldRefactor()`:

```typescript
const atMidpoint = progress >= 0.5 && progress < 0.6 && tddCycle.refactor_count === 0;
// Change 0.5 to 0.33 for more frequent refactoring
// Change to 0.66 for less frequent refactoring
```

## Success Criteria

✅ Migration successful if:
- Database migration applied without errors
- No sessions stuck in `tdd_red` status
- New TDD sessions create ~6 AI jobs (not 30+)
- Tests limited to 5-8 per story
- Refactoring only at strategic points
- Sessions complete in 5-10 minutes (not 30-60)

## Support

If you encounter issues:
1. Check logs: `tail -f packages/worker/logs/*.log`
2. Check database: `SELECT * FROM coding_sessions WHERE status LIKE 'tdd%';`
3. Review documentation: `docs/TDD_OPTIMIZATION_COMPLETE.md`

---

**Last Updated:** December 24, 2025
**Version:** 1.0.0

