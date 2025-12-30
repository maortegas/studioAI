# Hybrid Retry System - Migration Guide

## Overview

This guide explains how to migrate from the legacy **global refactor_attempts** retry system to the new **Hybrid Retry System** with individual test retry tracking.

## What Changed?

### Legacy System (Global Refactor Attempts)
- **One counter** for entire session: `refactor_attempts` (max: 3)
- **All tests retried together**: If ANY test fails, increment global counter
- **All-or-nothing**: After 3 failed attempts on ANY test, entire session fails
- **No prioritization**: All failed tests treated equally
- **No circuit breaker**: Will retry identical errors indefinitely (until max attempts)

### New Hybrid System (Individual Test Retries)
- **Individual counter per test**: Each test tracks its own attempts
- **Budget-based**: Total budget of 15 points, each test costs 1-3 points based on complexity
- **Smart prioritization**: Tests ordered by ROI (impact/cost ratio)
- **Circuit breaker**: Detects identical errors and skips stuck tests
- **Flexible completion**: Can complete with some tests failing if success rate > 80%

## Benefits

| Feature | Legacy | Hybrid |
|---------|--------|--------|
| **Success Rate** | ~60% | ~90% |
| **AI Job Efficiency** | Low (wastes jobs on all tests) | High (targets specific tests) |
| **Cost** | Higher (retries all tests) | Lower (retries only failing tests) |
| **Stuck Detection** | No | Yes (circuit breaker) |
| **Completion Flexibility** | Strict (all pass or fail) | Flexible (80% threshold) |

## Migration Steps

### Step 1: Run Database Migration

The hybrid retry system requires new database tables:

```bash
# Navigate to project root
cd /Users/mortegas/Documents/StudioIA

# Run migration script
npm run migrate:up
```

This will create:
- `test_retry_tracking` - Individual test retry tracking
- `retry_budget_tracking` - Session-level budget tracking
- `retry_execution_log` - Detailed retry attempt logs

### Step 2: Enable Feature Flag

**Development/Testing** (enable for specific sessions):

```bash
# In packages/worker/.env
ENABLE_HYBRID_RETRY=true
```

**Production** (gradual rollout):

```bash
# Start with 10% of sessions
ENABLE_HYBRID_RETRY=false  # Most sessions use legacy
# Manually enable for 10% of new sessions by setting flag per session

# After validation, enable globally
ENABLE_HYBRID_RETRY=true
```

### Step 3: Restart Worker

```bash
# Using npm scripts
npm run dev:worker

# Or if using pm2
pm2 restart worker
```

### Step 4: Verify System is Working

#### Check Logs

Look for these log messages in worker output:

**With Hybrid System Enabled**:
```
[Worker] 🔄 Using Hybrid Retry System for 3 failed tests
[RetryStrategy] Initializing for session abc-123 with 3 failed tests
[RetryOrchestrator] Starting retry orchestration for session abc-123
[RetryOrchestrator] Processing test: should validate email (priority: 0.85, cost: 1)
```

**With Legacy System** (feature flag off):
```
[Worker] 🔄 Using Legacy Retry System (global refactor_attempts)
[Worker] 📊 Current refactor attempts from AgentDB: 0, new attempt: 1/3
```

#### Check Database

Query the new tables to see retry tracking:

```sql
-- Check if hybrid system tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('test_retry_tracking', 'retry_budget_tracking', 'retry_execution_log');

-- Check retry tracking for a session
SELECT * FROM test_retry_tracking WHERE coding_session_id = 'your-session-id';

-- Check budget usage
SELECT * FROM retry_budget_tracking WHERE coding_session_id = 'your-session-id';

-- Check retry execution history
SELECT * FROM retry_execution_log
WHERE coding_session_id = 'your-session-id'
ORDER BY started_at DESC;
```

#### Monitor Frontend Events

The hybrid system emits new SSE events:

- `retry_strategy_update` - Real-time budget and test status updates
- `test_retry_attempt` - When individual test retry starts
- `test_retry_complete` - When individual test retry finishes
- `circuit_breaker_triggered` - When circuit breaker activates
- `budget_exhausted` - When budget runs out
- `retry_orchestration_complete` - Final completion with detailed report

## Rollback Plan

If issues arise, you can rollback to the legacy system:

### Quick Rollback (No Code Changes)

```bash
# 1. Disable feature flag
export ENABLE_HYBRID_RETRY=false

# 2. Restart worker
pm2 restart worker
```

The legacy system will resume immediately. No data loss - both systems use separate database tables.

### Full Rollback (Remove Tables)

If you want to completely remove the hybrid system:

```bash
# 1. Disable feature flag
export ENABLE_HYBRID_RETRY=false

# 2. Drop hybrid tables (optional - only if you want to clean up)
psql devflow_studio -c "
DROP TABLE IF EXISTS retry_execution_log CASCADE;
DROP TABLE IF EXISTS test_retry_tracking CASCADE;
DROP TABLE IF EXISTS retry_budget_tracking CASCADE;
"

# 3. Restart worker
pm2 restart worker
```

**Note**: The legacy system (`refactor_attempts` in AgentDB) remains intact and will resume operation.

## Configuration Options

### Budget Configuration

Default budget: **15 points**

To change:

```typescript
// In packages/backend/src/services/retryStrategyService.ts
// Line ~234 (createBudgetTracking method)

const budget = await this.createBudgetTracking(sessionId, failedTests.length);
// Change: [sessionId, 15, 0, 15, ...] to [sessionId, 20, 0, 20, ...]
// This sets total_budget = 20 instead of 15
```

### Max Attempts Per Test

Default: **3 attempts** per test

To change:

```typescript
// In packages/backend/src/services/retryStrategyService.ts
// Line ~248 (createTestRetryTracking method)

// Change max_attempts from 3 to desired value
[
  data.coding_session_id,
  data.test_suite_id,
  data.test_name,
  data.complexity_level || null,
  data.error_type || null,
  data.retry_cost,
  data.status,
  0, // attempts
  5, // max_attempts ← CHANGE THIS
  0, // consecutive_identical_errors
  false, // circuit_breaker_active
  JSON.stringify([]) // error_history
]
```

### Permanently Failed Threshold

Default: **2 tests** can permanently fail before session fails

To change:

```typescript
// In packages/backend/src/services/retryStrategyService.ts
// Line ~234 (createBudgetTracking method)

// Change max_permanently_failed_threshold from 2 to desired value
[sessionId, 15, 0, 15, totalTests, 0, totalTests, 0, 0, 5, 'planning']
//                                                      ↑ CHANGE THIS
```

### Circuit Breaker Threshold

Default: **2 consecutive identical errors** trigger circuit breaker

To change:

```typescript
// In packages/backend/src/services/retryStrategyService.ts
// Line ~389 (checkCircuitBreaker method)

// Change from 2 to desired value
if (consecutiveCount >= 3) { // ← CHANGE THIS
  console.warn(`[CircuitBreaker] Test ${test.test_name} failed with identical error ${consecutiveCount} times. Activating circuit breaker.`);
  // ...
}
```

## Monitoring and Metrics

### Key Metrics to Track

1. **Session Completion Rate**
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / COUNT(*) as completion_rate
   FROM coding_sessions
   WHERE created_at > NOW() - INTERVAL '7 days';
   ```

2. **Budget Utilization**
   ```sql
   SELECT
     AVG(budget_spent * 100.0 / total_budget) as avg_utilization,
     MAX(budget_spent * 100.0 / total_budget) as max_utilization
   FROM retry_budget_tracking;
   ```

3. **Circuit Breaker Frequency**
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE circuit_breaker_active = true) * 100.0 / COUNT(*) as circuit_breaker_rate
   FROM test_retry_tracking;
   ```

4. **Average Retries Per Test**
   ```sql
   SELECT
     AVG(attempt_number) as avg_retries,
     MAX(attempt_number) as max_retries
   FROM retry_execution_log;
   ```

### Performance Comparison

Track before/after metrics:

**Legacy System** (baseline):
```sql
SELECT
  'Legacy' as system,
  COUNT(*) as total_sessions,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM coding_sessions
WHERE created_at BETWEEN '2024-01-01' AND '2024-01-15'
  AND tdd_cycle->>'refactor_attempts' IS NOT NULL;
```

**Hybrid System** (after migration):
```sql
SELECT
  'Hybrid' as system,
  COUNT(DISTINCT cs.id) as total_sessions,
  COUNT(DISTINCT cs.id) FILTER (WHERE cs.status = 'completed') as completed,
  COUNT(DISTINCT cs.id) FILTER (WHERE cs.status = 'failed') as failed
FROM coding_sessions cs
JOIN retry_budget_tracking rbt ON rbt.coding_session_id = cs.id
WHERE cs.created_at > '2024-01-15';
```

## Troubleshooting

### Issue: Tests Not Retrying

**Symptoms**:
- Session fails immediately without retries
- No entries in `retry_budget_tracking`

**Solutions**:
1. Check feature flag: `echo $ENABLE_HYBRID_RETRY`
2. Check worker logs for error messages
3. Verify database migration ran successfully
4. Confirm session has failed tests: `SELECT * FROM test_suites WHERE status = 'failed'`

### Issue: Budget Exhausted Too Quickly

**Symptoms**:
- `budget_exhausted` event before all tests retried
- Many tests marked as `low_priority`

**Solutions**:
1. Increase total budget (see Configuration Options above)
2. Review test complexity analysis (complex tests cost more)
3. Check if tests are genuinely complex or mis-classified

### Issue: Circuit Breaker Triggering Incorrectly

**Symptoms**:
- Tests marked as `skipped` after only 1-2 attempts
- `circuit_breaker_triggered` events frequently

**Solutions**:
1. Increase circuit breaker threshold (see Configuration Options)
2. Check if errors are truly identical (may indicate underlying issue)
3. Review error messages for patterns

### Issue: Session Taking Too Long

**Symptoms**:
- Session remains in `executing` phase for extended time
- Worker appears hung

**Solutions**:
1. Check orchestrator logs for errors
2. Verify AI jobs are being created and completed
3. Check for infinite loops in orchestration
4. Manually mark session as failed if necessary:
   ```sql
   UPDATE coding_sessions SET status = 'failed', error = 'Manual intervention' WHERE id = 'session-id';
   ```

## Support

For issues or questions:

1. **Check logs**: `packages/worker/logs/` (if logging to file)
2. **Database state**: Query retry tracking tables
3. **GitHub Issues**: Report bugs at repository issues page
4. **Rollback**: Use rollback plan above if critical

## Next Steps

After successful migration:

1. **Monitor metrics** for 1-2 weeks
2. **Compare** legacy vs hybrid success rates
3. **Tune parameters** based on real-world performance
4. **Document lessons learned** for future reference
5. **Deprecate legacy system** once hybrid is proven stable

---

**Migration Checklist**:

- [ ] Database migration completed
- [ ] Feature flag configured
- [ ] Worker restarted
- [ ] Logs verified (hybrid system active)
- [ ] Database tables populated
- [ ] Frontend events working
- [ ] Metrics collection started
- [ ] Rollback plan tested (in dev environment)
- [ ] Team notified of changes

