# Retry with Instructions - Test Scenario

**Date**: December 31, 2025
**Status**: ✅ Ready for Testing
**Feature**: Retry failed TDD sessions with custom user instructions

---

## 📋 Test Scenario Overview

A realistic test scenario has been created in the database to test the retry-with-instructions feature.

### Scenario Details:

- **Project**: TodoApp
- **Project ID**: `1f51f5b6-1008-4dee-936c-096792b06c6d`
- **Story**: Create Task Service with CRUD operations
- **Session ID**: `655d5da4-a481-40d8-8d1f-75d3250a68af`
- **Status**: `failed`
- **Progress**: 45%

### Error Details:

```
ReferenceError: Cannot access 'mockPrisma' before initialization
    at Object.<anonymous> (tests/unit/taskService.test.ts:14:19)
    at Promise.then.completed (/node_modules/jest-circus/build/utils.js:333:28)

This error is typically caused by jest.mock() being called after the mock is referenced.
Make sure all jest.mock() calls are at the top of the file, before any imports.
```

**This is a realistic Jest mock hoisting error** - one of the most common issues in TDD.

---

## 🎯 Testing Steps

### Prerequisites:

1. ✅ Backend running on http://localhost:3001
2. ✅ Frontend running on http://localhost:3002
3. ✅ Test scenario created in database

### Step 1: Open the Frontend

1. Navigate to: **http://localhost:3002**
2. You should see the DevFlow Studio homepage

### Step 2: Navigate to Project

1. Click on **"TodoApp"** project (or navigate to projects page)
2. Look for the **Implementation Dashboard** or **Coding Sessions** section

### Step 3: Find the Failed Session

Look for the session with:
- **Story**: "Create Task Service with CRUD operations"
- **Status**: ❌ Failed (red indicator)
- **Progress**: 45%
- **Programmer Type**: Backend

You should see the session created at the top (most recent).

### Step 4: Click Retry Button

1. Click the **"Retry"** button on the failed session
2. **Expected**: The **Retry with Instructions Modal** should appear

### Step 5: Verify Modal Content

The modal should display:

#### Header:
```
🔧 Retry with Custom Instructions
Provide specific guidance to help the AI fix the failing tests
```

#### Test Error Section (red box):
```
❌ Current Test Failure:

ReferenceError: Cannot access 'mockPrisma' before initialization
    at Object.<anonymous> (tests/unit/taskService.test.ts:14:19)
    ...
```

#### Suggested Fixes Section (yellow box):
```
💡 Common Fixes for Similar Errors:

• Move jest.mock() call before all imports
• Create mock functions as const before jest.mock()
```

These suggestions should appear because the error pattern matches "Cannot access" + "before initialization".

#### Instructions Text Area:
- Empty text area with placeholder examples
- Should have 4 rows
- Placeholder text with examples of instructions

### Step 6: Test Suggested Fix (Option 1)

1. **Click** on one of the suggested fixes:
   - "Move jest.mock() call before all imports"

2. **Expected**: The text area should auto-fill with that suggestion

3. **Verify**: The "Retry with Instructions" button should be **enabled** (blue, not grayed out)

### Step 7: Test Custom Instructions (Option 2)

1. **Clear** the text area
2. **Type** custom instructions, for example:
   ```
   Create mock functions as const BEFORE the jest.mock() call.
   The mock functions (mockCreate, mockFindUnique, etc.) should be
   declared before being referenced in jest.mock().
   ```

3. **Verify**: The "Retry with Instructions" button should be **enabled**

### Step 8: Submit Retry with Instructions

1. Click **"🔄 Retry with Instructions"** button

2. **Expected behaviors**:
   - Button shows loading state: "Retrying..." with spinner
   - Modal closes after successful submission
   - Toast notification appears: "Retry started with your custom instructions"
   - Session list refreshes

### Step 9: Verify Backend Integration

Open a new terminal and run:

```bash
# 1. Verify instructions were stored in coding_session_events
docker compose exec postgres psql -U postgres -d devflow_studio -c "
SELECT event_type, payload
FROM coding_session_events
WHERE session_id = '655d5da4-a481-40d8-8d1f-75d3250a68af'
AND event_type = 'user_instructions';
"
```

**Expected Output**:
```
 event_type      | payload
-----------------+------------------------------------------------------------------
 user_instructions | {"instructions": "Your instructions here", "timestamp": "...", ...}
```

```bash
# 2. Verify session status was reset to pending
docker compose exec postgres psql -U postgres -d devflow_studio -c "
SELECT id, status, error
FROM coding_sessions
WHERE id = '655d5da4-a481-40d8-8d1f-75d3250a68af';
"
```

**Expected**: Status should be `pending` and error should be `NULL`.

```bash
# 3. Verify test suites were reset to ready
docker compose exec postgres psql -U postgres -d devflow_studio -c "
SELECT id, name, status
FROM test_suites
WHERE coding_session_id = '655d5da4-a481-40d8-8d1f-75d3250a68af';
"
```

**Expected**: Test suite status should be `ready`.

```bash
# 4. Verify AI job was created
docker compose exec postgres psql -U postgres -d devflow_studio -c "
SELECT id, status, args
FROM ai_jobs
ORDER BY created_at DESC
LIMIT 1;
"
```

**Expected**: A new AI job with `phase: 'tdd_green'` in args.

### Step 10: Verify Prompt Contains Instructions

The worker will pick up the job and execute it. To verify the prompt contains your instructions:

1. Check the worker logs (if running in dev mode)
2. Or check the `ai_jobs` table for the prompt field

The prompt should include:

```markdown
# 🔧 RETRY WITH USER INSTRUCTIONS

## ⚠️ CRITICAL: USER PROVIDED SPECIFIC INSTRUCTIONS

**The user has analyzed the test failure and provided these SPECIFIC INSTRUCTIONS:**

```
[Your instructions here]
```

**YOU MUST FOLLOW THESE INSTRUCTIONS EXACTLY.**

...
```

---

## ✅ Expected Results Summary

| Step | Expected Result | Status |
|------|----------------|---------|
| 1. Open frontend | Homepage loads | ⬜ |
| 2. Navigate to project | TodoApp project visible | ⬜ |
| 3. Find failed session | Session with "failed" status visible | ⬜ |
| 4. Click Retry | Modal appears | ⬜ |
| 5. Verify modal content | Error, suggestions, text area displayed | ⬜ |
| 6. Test suggested fix | Text area auto-fills, button enables | ⬜ |
| 7. Test custom instructions | Button enables when typing | ⬜ |
| 8. Submit retry | Loading state, modal closes, toast appears | ⬜ |
| 9. Verify backend | Instructions stored, session reset | ⬜ |
| 10. Verify prompt | Prompt includes CRITICAL section | ⬜ |

---

## 🐛 Edge Cases to Test

### Test 1: Empty Instructions

1. Open the modal
2. Leave the text area **empty**
3. Try to click "Retry with Instructions"

**Expected**: Button should be **disabled** (grayed out).

### Test 2: Whitespace Only

1. Open the modal
2. Type only spaces or tabs in the text area
3. Try to submit

**Expected**: Alert should appear: "Please provide instructions for the retry"

### Test 3: Cancel Button

1. Open the modal
2. Type some instructions
3. Click **"Cancel"** button

**Expected**: Modal closes, no API call made, session unchanged.

### Test 4: Very Long Instructions

1. Open the modal
2. Paste a very long instruction (500+ characters)
3. Submit

**Expected**: Should accept and submit successfully (no max length restriction).

### Test 5: Network Error

1. Stop the backend server: `kill -9 $(lsof -ti:3001)`
2. Try to retry with instructions

**Expected**:
- Error alert appears
- Modal stays open (allows retry)
- Button returns to enabled state

---

## 📊 Database State After Test

After completing the test, the database should have:

1. **coding_session_events** table:
   - New row with `event_type = 'user_instructions'`
   - Payload contains your instructions + timestamp + error context

2. **coding_sessions** table:
   - Session status changed from `failed` → `pending`
   - Error field cleared (NULL)

3. **test_suites** table:
   - Test suite status changed from `failed` → `ready`

4. **ai_jobs** table:
   - New AI job created
   - Prompt includes CRITICAL section with user instructions

---

## 🔄 Reset Test Scenario (Optional)

If you want to test again, you can reset the session to failed state:

```bash
docker compose exec postgres psql -U postgres -d devflow_studio -c "
-- Reset session to failed
UPDATE coding_sessions
SET status = 'failed',
    error = E'ReferenceError: Cannot access ''mockPrisma'' before initialization\n    at Object.<anonymous> (tests/unit/taskService.test.ts:14:19)\n    at Promise.then.completed (/node_modules/jest-circus/build/utils.js:333:28)\n\nThis error is typically caused by jest.mock() being called after the mock is referenced.\nMake sure all jest.mock() calls are at the top of the file, before any imports.'
WHERE id = '655d5da4-a481-40d8-8d1f-75d3250a68af';

-- Reset test suite to failed
UPDATE test_suites
SET status = 'failed'
WHERE coding_session_id = '655d5da4-a481-40d8-8d1f-75d3250a68af';

-- Delete user instructions events (optional)
DELETE FROM coding_session_events
WHERE session_id = '655d5da4-a481-40d8-8d1f-75d3250a68af'
AND event_type = 'user_instructions';
"
```

---

## 📝 Test Notes

- **Frontend URL**: http://localhost:3002
- **Backend URL**: http://localhost:3001
- **Session ID**: `655d5da4-a481-40d8-8d1f-75d3250a68af`
- **Project ID**: `1f51f5b6-1008-4dee-936c-096792b06c6d`

---

## ✅ Success Criteria

The feature is working correctly if:

1. ✅ Modal appears when clicking Retry on a failed session
2. ✅ Error is displayed clearly in red box
3. ✅ Suggested fixes appear for detected error patterns
4. ✅ Text area accepts custom instructions
5. ✅ Submit button is disabled when empty
6. ✅ Instructions are stored in database
7. ✅ Session and test suites are reset
8. ✅ AI job is created with modified prompt
9. ✅ Prompt includes CRITICAL section with user instructions
10. ✅ Modal closes and toast appears on success

---

**Ready to Test!** 🚀

Start with Step 1 and work through the test scenario. Report any issues or unexpected behavior.
