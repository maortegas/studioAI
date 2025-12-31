# Retry with Instructions - Implementation Summary ✅

**Date**: December 31, 2025
**Status**: ✅ **IMPLEMENTED AND COMMITTED**
**Commit**: `8f64ada - feat: implement retry with user instructions to break infinite loops`

---

## 🎯 Problem Solved

When TDD tests fail, the system can enter **infinite retry loops** by attempting the same failing solution repeatedly. Users had no way to provide specific guidance to break the loop.

---

## ✅ Implementation Complete

All components have been implemented and committed to the repository.

### Frontend (3 files)

#### 1. ✅ `RetryWithInstructionsModal.tsx` (NEW - 196 lines)

**Location**: `packages/frontend/src/components/RetryWithInstructionsModal.tsx`

**Features**:
- Shows test error clearly in red box with monospace font
- Text area for user instructions (4 rows)
- Suggested fixes based on error pattern detection
- Clean UI with Cancel/Submit buttons
- Submit button disabled until instructions provided
- Loading state during submission

**Suggested Fixes Detection**:
```typescript
- "Cannot access...before initialization" → Mock hoisting fixes
- "prisma...did not initialize" → Prisma generate suggestions
- "MODULE_NOT_FOUND" → Import path fixes
- "Multiple configurations found" → Jest config cleanup
- "duplicate...describe" → Remove duplicate suites
```

#### 2. ✅ `ImplementationDashboard.tsx` (Updated)

**Changes**:
- Added import for `RetryWithInstructionsModal`
- Added state: `retryModalOpen` and `selectedSessionForRetry`
- Modified `handleRetrySession`: Opens modal if session failed with error
- Added `handleRetryWithInstructions`: Calls API with instructions
- Added modal JSX at end of component
- Modal shows automatically when clicking Retry on failed session

#### 3. ✅ `codingSessions.ts` API (Updated)

**New Method**:
```typescript
retrySessionWithInstructions: async (sessionId: string, instructions: string)
  → POST /api/coding-sessions/:id/retry-with-instructions
  → Returns: { message, job_id, session_id }
```

### Backend (2 files)

#### 4. ✅ `coding-sessions.ts` Routes (Updated)

**New Route**:
```typescript
POST /:sessionId/retry-with-instructions
- Validates instructions are provided (required, non-empty)
- Calls sessionService.retrySessionWithInstructions()
- Returns: { message, job_id, session_id }
- Error handling with 400 for missing instructions, 500 for errors
```

#### 5. ✅ `codingSessionService.ts` (Updated - 2 new methods)

**Method 1: `retrySessionWithInstructions()`** (97 lines)

Logic:
1. Fetch session details
2. Get failed test suites
3. Get test execution error details (last error message/output)
4. Store user instructions in `coding_session_events` (event_type: 'user_instructions')
5. Reset session status to 'pending', clear error
6. Reset test suites to 'ready', clear errors
7. Build retry prompt with instructions
8. Create AI job with custom prompt
9. Return job info

**Method 2: `buildRetryPromptWithInstructions()`** (45 lines)

Prompt Structure:
```markdown
[Context Bundle from buildPromptBundle()]
---

# 🔧 RETRY WITH USER INSTRUCTIONS

## ⚠️ CRITICAL: USER PROVIDED SPECIFIC INSTRUCTIONS

**The user has analyzed the test failure and provided these SPECIFIC INSTRUCTIONS:**

```
[User's instructions here]
```

**YOU MUST FOLLOW THESE INSTRUCTIONS EXACTLY.**

The user knows the codebase and has identified the specific issue.
Do NOT ignore their guidance.

## Test Failure Details

The previous implementation attempt failed with this error:

```
[Error details from test execution]
```

## Your Task

1. READ the user instructions carefully (they know what went wrong)
2. APPLY their specific guidance to fix the issue
3. IMPLEMENT the fix following their directions
4. VERIFY that your changes address their concerns

## Important Notes

- The user's instructions are HIGHER PRIORITY than general best practices
- If there's a conflict between user instructions and PRD/RFC, FOLLOW USER INSTRUCTIONS
- The user is trying to help you avoid repeating the same mistake
- Be grateful for their help and implement exactly what they suggest
```

---

## 📊 Implementation Statistics

| Component | Status | Lines Added | Complexity |
|-----------|--------|-------------|------------|
| RetryWithInstructionsModal.tsx | ✅ NEW | 196 | Medium |
| ImplementationDashboard.tsx | ✅ Updated | +30 | Low |
| codingSessions.ts (API) | ✅ Updated | +4 | Low |
| coding-sessions.ts (Routes) | ✅ Updated | +18 | Low |
| codingSessionService.ts | ✅ Updated | +155 | Medium |
| **TOTAL** | ✅ | **403 lines** | - |

---

## 🎬 User Flow

### Step-by-Step

1. **User sees failed session** in Implementation Dashboard
   - Status: "failed" (red indicator)
   - Error message visible in session details

2. **User clicks "Retry" button**
   - System detects session has errors
   - `handleRetrySession` opens modal instead of simple retry

3. **Modal appears with**:
   - ❌ Test error displayed clearly (red box, monospace)
   - 💡 Text area for instructions (placeholder with examples)
   - 💡 Suggested fixes (auto-detected from error pattern)
   - [Cancel] [🔄 Retry with Instructions] buttons

4. **User provides instructions**:
   - Types specific guidance (e.g., "Move jest.mock() before imports")
   - OR clicks a suggested fix to auto-fill
   - Submit button enables when instructions not empty

5. **User clicks "Retry with Instructions"**:
   - Button shows loading state ("Retrying...")
   - API call: `POST /api/coding-sessions/:id/retry-with-instructions`
   - Modal closes on success
   - Toast notification: "Retry started with your custom instructions"

6. **Backend processes**:
   - Stores instructions in `coding_session_events`
   - Resets session/test suite status
   - Creates AI job with **modified prompt** (instructions at top)

7. **AI receives prompt with**:
   - ⚠️ **CRITICAL section** with user instructions
   - Test failure details
   - Explicit directive to follow user's guidance

8. **AI implements fix**:
   - Follows user's specific instructions
   - Applies the exact changes suggested
   - Avoids repeating the same mistake

9. **Tests run again**:
   - If instructions were correct → Tests pass ✅
   - If issue persists → User can retry again with different instructions

10. **Dashboard updates**:
    - Session shows "running" status
    - Real-time SSE updates show progress
    - User sees test results when complete

---

## 💡 Example Scenarios

### Scenario 1: Mock Hoisting Error

**Error**:
```
ReferenceError: Cannot access 'mockPrisma' before initialization
at Object.<anonymous> (tests/unit/employee.test.ts:14:19)
```

**Modal Shows**:
```
💡 Suggested Fixes:
• Move jest.mock() call before all imports
• Create mock functions as const before jest.mock()
```

**User Selects**: "Create mock functions as const before jest.mock()"

**AI Receives**:
```
## ⚠️ CRITICAL: USER PROVIDED SPECIFIC INSTRUCTIONS

Create mock functions as const before jest.mock()

**YOU MUST FOLLOW THESE INSTRUCTIONS EXACTLY.**
```

**AI Fixes**:
```typescript
// ✅ BEFORE
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

// ✅ NOW use them
jest.mock('../../src/config/database', () => ({
  prisma: {
    employee: { findUnique: mockFindUnique, update: mockUpdate }
  }
}));
```

**Result**: Tests pass ✅

### Scenario 2: Wrong Import Path

**Error**:
```
Cannot find module '../../services/taskService'
Error: Cannot find module '../../services/taskService'
```

**User Types**:
```
Change import path from '../../services/taskService' to
'../../src/services/taskService'. The project has a src/ directory.
```

**AI Receives**: User's exact instructions as CRITICAL

**AI Fixes**:
```typescript
// ❌ BEFORE
import { TaskService } from '../../services/taskService';

// ✅ AFTER
import { TaskService } from '../../src/services/taskService';
```

**Result**: Tests pass ✅

### Scenario 3: Prisma Schema Issue

**Error**:
```
Error: @prisma/client did not initialize yet. Please run "prisma generate"
```

**Modal Shows**:
```
💡 Suggested Fixes:
• Run npx prisma generate to create Prisma client
• Check if prisma/schema.prisma exists and is valid
```

**User Types**:
```
The Prisma schema uses 'deletedAt' in the model but indexes reference
'deleted_at'. Fix the index names to match the model field.
```

**AI Receives**: Instructions to fix schema inconsistency

**AI Fixes**: Updates schema indexes to use `deletedAt`

**Result**: Tests pass ✅

---

## 🔧 Technical Details

### Data Storage

**Instructions stored in**: `coding_session_events` table

```sql
INSERT INTO coding_session_events (session_id, event_type, payload)
VALUES (
  'session-id',
  'user_instructions',
  '{
    "instructions": "User's guidance here",
    "timestamp": "2025-12-31T12:00:00.000Z",
    "error_context": "First 500 chars of error..."
  }'
)
```

**Benefits**:
- Preserves history of user interventions
- Can analyze which instructions work best
- Can improve prompts based on successful patterns
- No schema changes required (uses existing table)

### Error Pattern Detection

**Function**: `getSuggestedFixes(error: string)`

**Patterns Detected**:
1. Mock hoisting: `"Cannot access" + "before initialization"`
2. Prisma: `"prisma" + "did not initialize"`
3. Missing modules: `"MODULE_NOT_FOUND"` or `"Cannot find module"`
4. Mock functions: `"mockResolvedValue"` or `"mockReturnValue"`
5. Undefined properties: `"undefined" + "property"`
6. Jest config: `"Multiple configurations found"` or `"jest.config"`
7. Duplicate suites: `"duplicate"` or `"describe"`

**Fallback**: If no pattern matches, shows generic suggestions

### API Error Handling

**Route Validation**:
```typescript
if (!instructions || !instructions.trim()) {
  return res.status(400).json({ error: 'Instructions are required' });
}
```

**Service Errors**:
- Session not found → `Error: 'Coding session not found'`
- No failed tests → `Error: 'No failed tests found for this session'`
- Story not found → `Error: 'Story not found'`

**Frontend Handling**:
```typescript
try {
  await onSubmit(instructions);
  onClose(); // Success
} catch (error) {
  alert(error.message); // Show error, keep modal open
  setIsSubmitting(false); // Allow retry
}
```

---

## 🧪 Testing Recommendations

### Manual Testing Steps

1. **Create test project** with failing tests
   ```bash
   - Create TDD session
   - Ensure tests fail (wrong import, hoisting error, etc.)
   ```

2. **Open Implementation Dashboard**
   ```bash
   - Navigate to project
   - See failed session (red status)
   ```

3. **Click Retry**
   ```bash
   - Modal should appear
   - Error should be displayed
   - Suggested fixes should appear (if pattern detected)
   ```

4. **Provide instructions**
   ```bash
   - Type specific guidance
   - Or click a suggested fix
   - Submit button should enable
   ```

5. **Submit retry**
   ```bash
   - Loading state should show
   - Modal should close
   - Toast notification should appear
   - Dashboard should update
   ```

6. **Verify backend**
   ```bash
   - Check coding_session_events table for user_instructions event
   - Check coding_sessions status changed to 'pending'
   - Check test_suites status changed to 'ready'
   - Check ai_jobs for new job with custom prompt
   ```

7. **Watch execution**
   ```bash
   - Worker should pick up job
   - AI should receive prompt with instructions
   - Tests should run
   - Verify fix was applied as instructed
   ```

### Edge Cases to Test

1. **Empty instructions**: Submit button should be disabled
2. **Whitespace only**: Should validate and show error
3. **Very long instructions**: Should accept (no max length)
4. **Session without errors**: Should do simple retry (no modal)
5. **Session not found**: Should show error
6. **No failed tests**: Should show error
7. **Network error**: Should show error, keep modal open

---

## 📚 Files Reference

### Frontend
- `packages/frontend/src/components/RetryWithInstructionsModal.tsx` (NEW)
- `packages/frontend/src/components/ImplementationDashboard.tsx`
- `packages/frontend/src/api/codingSessions.ts`

### Backend
- `packages/backend/src/routes/coding-sessions.ts`
- `packages/backend/src/services/codingSessionService.ts`

### Documentation
- `docs/RETRY_WITH_INSTRUCTIONS_DESIGN.md` (Design)
- `docs/RETRY_WITH_INSTRUCTIONS_IMPLEMENTATION_SUMMARY.md` (This file)

---

## 🚀 Deployment Checklist

- [x] Frontend components implemented
- [x] Frontend API methods added
- [x] Backend routes added
- [x] Backend service methods implemented
- [x] Error handling implemented
- [x] Code committed to repository
- [ ] Frontend build tested
- [ ] Backend build tested
- [ ] Manual end-to-end testing
- [ ] Production deployment

---

## 🎯 Success Metrics

Track these metrics to measure effectiveness:

1. **Loop Prevention**: % of failed sessions that retry with instructions vs. infinite loops
2. **Success Rate**: % of retries with instructions that succeed
3. **Time to Resolution**: Average time from failure to success (with vs. without instructions)
4. **Instruction Quality**: Analysis of which instruction patterns work best
5. **User Engagement**: % of users who use the feature vs. simple retry

---

## 🔮 Future Enhancements

1. **Instruction Templates**: Pre-fill common fixes for detected error types
2. **AI-Suggested Instructions**: Analyze error and suggest instructions automatically
3. **Instruction History**: Show previous instructions for similar errors
4. **Learning Loop**: Use successful instructions to improve prompt generation
5. **Multi-User**: Allow team collaboration on instructions
6. **Retry Instructions Table**: Dedicated table for better analytics (optional migration)

---

**Status**: ✅ Ready for Testing
**Next Steps**: Manual testing → Production deployment

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
