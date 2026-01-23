# Retry with User Instructions - Design Document

**Date**: December 31, 2025
**Status**: Design Phase
**Priority**: High

## Problem Statement

When TDD tests fail, the current retry system can enter infinite loops by repeatedly attempting the same solution. Users need a way to provide specific instructions/hints to guide the AI toward a successful implementation and break the loop.

## Requirements

1. **Show Test Failure Details**: Clearly display where and why tests are failing
2. **User Instructions Input**: Allow users to provide specific guidance for retry attempts
3. **Avoid Infinite Loops**: Include user instructions in retry prompts to change the approach
4. **Track Retry History**: Show previous attempts and user interventions

## Proposed Solution

### 1. Frontend Changes

#### A. Add Instructions Modal Component

**Location**: `packages/frontend/src/components/RetryWithInstructionsModal.tsx` (NEW)

```typescript
import { useState } from 'react';

interface RetryWithInstructionsModalProps {
  sessionId: string;
  testError: string;
  onClose: () => void;
  onSubmit: (instructions: string) => Promise<void>;
}

export default function RetryWithInstructionsModal({
  sessionId,
  testError,
  onClose,
  onSubmit
}: RetryWithInstructionsModalProps) {
  const [instructions, setInstructions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!instructions.trim()) {
      alert('Please provide instructions for the retry');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(instructions);
      onClose();
    } catch (error: any) {
      alert(error.message || 'Failed to retry with instructions');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            🔧 Retry with Custom Instructions
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Provide specific guidance to help the AI fix the failing tests
          </p>
        </div>

        {/* Test Error Display */}
        <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20">
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-300 mb-2">
            ❌ Current Test Failure:
          </h3>
          <pre className="text-xs bg-gray-900 text-red-400 p-3 rounded overflow-x-auto">
            {testError}
          </pre>
        </div>

        {/* Instructions Input */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            💡 Your Instructions (be specific):
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Examples:
- Use mockResolvedValue instead of mockReturnValue for async functions
- The schema should use 'deletedAt' not 'deleted_at' in Prisma model
- Add beforeEach hook to clear mocks between tests
- Import TaskService from '../../src/services/taskService' not '../services/taskService'"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            💡 Tip: Be specific about what to change, what's wrong, or what approach to use
          </p>
        </div>

        {/* Suggested Fixes (based on error analysis) */}
        <div className="px-6 py-4 bg-yellow-50 dark:bg-yellow-900/20">
          <h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-300 mb-2">
            💡 Common Fixes for Similar Errors:
          </h3>
          <ul className="text-xs space-y-1 text-yellow-800 dark:text-yellow-400">
            {getSuggestedFixes(testError).map((fix, i) => (
              <li key={i} className="flex items-start">
                <span className="mr-2">•</span>
                <button
                  onClick={() => setInstructions(fix)}
                  className="text-left hover:underline cursor-pointer"
                >
                  {fix}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700
                     rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !instructions.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                     transition disabled:opacity-50 flex items-center space-x-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span>Retrying...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Retry with Instructions</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper function to suggest fixes based on error patterns
function getSuggestedFixes(error: string): string[] {
  const fixes: string[] = [];

  if (error.includes('Cannot access') && error.includes('before initialization')) {
    fixes.push('Move jest.mock() call before all imports');
    fixes.push('Create mock functions as const before jest.mock()');
  }

  if (error.includes('prisma') && error.includes('did not initialize')) {
    fixes.push('Run npx prisma generate to create Prisma client');
    fixes.push('Check if prisma/schema.prisma exists and is valid');
  }

  if (error.includes('MODULE_NOT_FOUND')) {
    fixes.push('Check import paths are correct (relative vs absolute)');
    fixes.push('Verify the file exists in the expected location');
  }

  if (error.includes('mockResolvedValue') || error.includes('async')) {
    fixes.push('Use mockResolvedValue for async functions instead of mockReturnValue');
  }

  if (error.includes('undefined')) {
    fixes.push('Check if properties/methods exist before calling them');
    fixes.push('Add proper type guards or optional chaining');
  }

  if (fixes.length === 0) {
    fixes.push('Describe what you want to change or fix');
    fixes.push('Specify the exact error and how to resolve it');
  }

  return fixes;
}
```

#### B. Update ImplementationDashboard.tsx

**Location**: `packages/frontend/src/components/ImplementationDashboard.tsx`

**Changes**:

```typescript
// Add state for modal
const [retryModalOpen, setRetryModalOpen] = useState(false);
const [selectedSessionForRetry, setSelectedSessionForRetry] = useState<CodingSession | null>(null);

// Update handleRetrySession to open modal instead
const handleRetrySession = async (session: CodingSession, event: React.MouseEvent) => {
  event.stopPropagation();

  // If session has test errors, show instructions modal
  if (session.status === 'failed' && session.error) {
    setSelectedSessionForRetry(session);
    setRetryModalOpen(true);
  } else {
    // Simple retry without instructions
    try {
      const result = await codingSessionsApi.retrySession(session.id);
      showToast(result.message, 'success');
      await loadDashboard();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to retry session', 'error');
    }
  }
};

// Add retry with instructions handler
const handleRetryWithInstructions = async (instructions: string) => {
  if (!selectedSessionForRetry) return;

  try {
    const result = await codingSessionsApi.retrySessionWithInstructions(
      selectedSessionForRetry.id,
      instructions
    );
    showToast(result.message, 'success');
    await loadDashboard();
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Failed to retry session');
  }
};

// In the JSX, add the modal
{retryModalOpen && selectedSessionForRetry && (
  <RetryWithInstructionsModal
    sessionId={selectedSessionForRetry.id}
    testError={selectedSessionForRetry.error || 'Unknown error'}
    onClose={() => {
      setRetryModalOpen(false);
      setSelectedSessionForRetry(null);
    }}
    onSubmit={handleRetryWithInstructions}
  />
)}
```

#### C. Add API Method

**Location**: `packages/frontend/src/api/codingSessions.ts`

```typescript
export const codingSessionsApi = {
  // ... existing methods ...

  retrySessionWithInstructions: async (sessionId: string, instructions: string) => {
    const response = await axios.post(
      `${API_BASE_URL}/api/coding-sessions/${sessionId}/retry-with-instructions`,
      { instructions }
    );
    return response.data;
  },
};
```

### 2. Backend Changes

#### A. Add Route Handler

**Location**: `packages/backend/src/routes/coding-sessions.ts`

```typescript
// Retry with custom instructions
router.post('/:sessionId/retry-with-instructions', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { instructions } = req.body;

    if (!instructions || !instructions.trim()) {
      return res.status(400).json({ error: 'Instructions are required' });
    }

    const result = await sessionService.retrySessionWithInstructions(sessionId, instructions);
    res.json(result);
  } catch (error: any) {
    console.error('Error retrying session with instructions:', error);
    res.status(500).json({ error: error.message });
  }
});
```

#### B. Add Service Method

**Location**: `packages/backend/src/services/codingSessionService.ts`

Add new method:

```typescript
/**
 * Retry a failed coding session with custom user instructions
 */
async retrySessionWithInstructions(sessionId: string, userInstructions: string): Promise<any> {
  console.log(`[CodingSessionService] Retrying session ${sessionId} with custom instructions`);

  // Get session details
  const session = await this.sessionRepo.findById(sessionId);
  if (!session) {
    throw new Error('Coding session not found');
  }

  // Get test failures
  const testSuites = await pool.query(
    'SELECT id, name, error FROM test_suites WHERE coding_session_id = $1 AND status = \'failed\'',
    [sessionId]
  );

  if (testSuites.rows.length === 0) {
    throw new Error('No failed tests found for this session');
  }

  // Get test execution errors
  const testExecutions = await pool.query(
    `SELECT error_message, output FROM test_executions
     WHERE test_suite_id IN (
       SELECT id FROM test_suites WHERE coding_session_id = $1 AND status = 'failed'
     )
     ORDER BY completed_at DESC LIMIT 1`,
    [sessionId]
  );

  const errorDetails = testExecutions.rows[0]?.error_message ||
                      testExecutions.rows[0]?.output ||
                      'Unknown error';

  // Store user instructions in coding_session_events for context
  await pool.query(
    `INSERT INTO coding_session_events (session_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [
      sessionId,
      'user_instructions',
      JSON.stringify({
        instructions: userInstructions,
        timestamp: new Date().toISOString(),
        error_context: errorDetails.substring(0, 500) // First 500 chars of error
      })
    ]
  );

  // Reset session status to allow retry
  await pool.query(
    `UPDATE coding_sessions
     SET status = $1, error = NULL
     WHERE id = $2`,
    ['pending', sessionId]
  );

  // Reset test suites to ready
  await pool.query(
    `UPDATE test_suites
     SET status = 'ready', error = NULL
     WHERE coding_session_id = $1 AND status = 'failed'`,
    [sessionId]
  );

  // Create retry AI job with user instructions included in prompt
  const story = await this.taskRepo.findById(session.story_id);
  if (!story) {
    throw new Error('Story not found');
  }

  // Build prompt with user instructions
  const retryPrompt = await this.buildRetryPromptWithInstructions(
    session.project_id,
    story,
    errorDetails,
    userInstructions
  );

  // Create AI job for retry
  const job = await this.aiService.createAIJob({
    project_id: session.project_id,
    coding_session_id: sessionId,
    phase: 'tdd_green',
    prompt: retryPrompt,
    mode: 'code'
  });

  console.log(`[CodingSessionService] Created retry job ${job.id} with user instructions`);

  return {
    message: 'Retry started with your custom instructions',
    job_id: job.id,
    session_id: sessionId
  };
}

/**
 * Build retry prompt that includes user instructions
 */
private async buildRetryPromptWithInstructions(
  projectId: string,
  story: any,
  errorDetails: string,
  userInstructions: string
): Promise<string> {
  const lines: string[] = [];

  // Get context bundle
  const promptBundle = await this.aiService.buildPromptBundle(projectId, story.id);
  lines.push(promptBundle);
  lines.push('\n---\n');

  lines.push(`# 🔧 RETRY WITH USER INSTRUCTIONS\n\n`);

  lines.push(`## ⚠️ CRITICAL: USER PROVIDED SPECIFIC INSTRUCTIONS\n\n`);
  lines.push(`**The user has analyzed the test failure and provided these SPECIFIC INSTRUCTIONS:**\n\n`);
  lines.push(`\`\`\`\n`);
  lines.push(userInstructions);
  lines.push(`\n\`\`\`\n\n`);

  lines.push(`**YOU MUST FOLLOW THESE INSTRUCTIONS EXACTLY.**\n\n`);
  lines.push(`The user knows the codebase and has identified the specific issue.`);
  lines.push(`Do NOT ignore their guidance.\n\n`);

  lines.push(`## Test Failure Details\n\n`);
  lines.push(`The previous implementation attempt failed with this error:\n\n`);
  lines.push(`\`\`\`\n`);
  lines.push(errorDetails);
  lines.push(`\n\`\`\`\n\n`);

  lines.push(`## Your Task\n\n`);
  lines.push(`1. **READ the user instructions carefully** (they know what went wrong)\n`);
  lines.push(`2. **APPLY their specific guidance** to fix the issue\n`);
  lines.push(`3. **IMPLEMENT the fix** following their directions\n`);
  lines.push(`4. **VERIFY** that your changes address their concerns\n\n`);

  lines.push(`## Important Notes\n\n`);
  lines.push(`- The user's instructions are HIGHER PRIORITY than general best practices\n`);
  lines.push(`- If there's a conflict between user instructions and PRD/RFC, FOLLOW USER INSTRUCTIONS\n`);
  lines.push(`- The user is trying to help you avoid repeating the same mistake\n`);
  lines.push(`- Be grateful for their help and implement exactly what they suggest\n\n`);

  return lines.join('\n');
}
```

### 3. Database Schema Addition (Optional)

To track retry history with instructions:

**Migration**: `database/migrations/XXX_add_retry_instructions.sql`

```sql
-- Add table to track retry attempts with user instructions
CREATE TABLE IF NOT EXISTS retry_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coding_session_id UUID NOT NULL REFERENCES coding_sessions(id) ON DELETE CASCADE,
  instructions TEXT NOT NULL,
  error_context TEXT,
  retry_attempt INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT retry_instructions_coding_session_id_fkey
    FOREIGN KEY (coding_session_id) REFERENCES coding_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_retry_instructions_session ON retry_instructions(coding_session_id);
```

## Implementation Checklist

- [ ] Create `RetryWithInstructionsModal.tsx` component
- [ ] Update `ImplementationDashboard.tsx` to use modal
- [ ] Add `retrySessionWithInstructions` API method
- [ ] Add route handler in `coding-sessions.ts`
- [ ] Add `retrySessionWithInstructions` service method
- [ ] Add `buildRetryPromptWithInstructions` service method
- [ ] Test the full flow end-to-end
- [ ] Add retry instructions table migration (optional)
- [ ] Update documentation

## Benefits

1. **No More Infinite Loops**: User can break the loop with specific guidance
2. **Faster Resolution**: User knows the codebase and can provide targeted fixes
3. **Learning System**: Instructions are stored and can be analyzed to improve prompts
4. **Better UX**: Users feel in control and can guide the AI when it's stuck
5. **Clear Error Display**: Users see exactly what failed and can diagnose the issue

## Example Usage

### Scenario: Mock Hoisting Error

**Test Error**:
```
ReferenceError: Cannot access 'mockPrisma' before initialization
```

**User Instructions**:
```
Move the mock function declarations (const mockFindUnique = jest.fn()) BEFORE the jest.mock() call.
The jest.mock() should reference these functions, not define them inline.
```

**Result**: AI understands the specific issue and fixes it correctly on the first retry.

### Scenario: Wrong Import Path

**Test Error**:
```
Cannot find module '../../services/taskService'
```

**User Instructions**:
```
Change the import path from '../../services/taskService' to '../../src/services/taskService'.
The project structure has a 'src' directory.
```

**Result**: AI corrects the import path immediately.

## Future Enhancements

1. **Instruction Templates**: Pre-fill common fixes based on error type
2. **AI-Suggested Instructions**: Analyze error and suggest instructions to user
3. **Instruction History**: Show previous instructions used for similar errors
4. **Learning Loop**: Use successful instructions to improve prompt generation
5. **Collaborative Mode**: Multiple users can contribute instructions

---

**Status**: Ready for Implementation
**Estimated Effort**: 4-6 hours
**Priority**: High (prevents infinite retry loops)
