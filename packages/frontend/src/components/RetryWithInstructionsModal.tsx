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
      setIsSubmitting(false);
    }
  };

  const suggestedFixes = getSuggestedFixes(testError);

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
          <pre className="text-xs bg-gray-900 text-red-400 p-3 rounded overflow-x-auto max-h-48">
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

        {/* Suggested Fixes */}
        {suggestedFixes.length > 0 && (
          <div className="px-6 py-4 bg-yellow-50 dark:bg-yellow-900/20">
            <h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-300 mb-2">
              💡 Common Fixes for Similar Errors:
            </h3>
            <ul className="text-xs space-y-1 text-yellow-800 dark:text-yellow-400">
              {suggestedFixes.map((fix, i) => (
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
        )}

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

  if (error.includes('MODULE_NOT_FOUND') || error.includes('Cannot find module')) {
    fixes.push('Check import paths are correct (relative vs absolute)');
    fixes.push('Verify the file exists in the expected location');
    fixes.push('Add src/ to the import path if project uses src directory');
  }

  if (error.includes('mockResolvedValue') || error.includes('mockReturnValue')) {
    fixes.push('Use mockResolvedValue for async functions instead of mockReturnValue');
  }

  if (error.includes('undefined') && error.includes('property')) {
    fixes.push('Check if properties/methods exist before calling them');
    fixes.push('Add proper type guards or optional chaining');
  }

  if (error.includes('Multiple configurations found') || error.includes('jest.config')) {
    fixes.push('Remove duplicate jest.config files (keep only jest.config.js)');
  }

  if (error.includes('duplicate') || error.includes('describe')) {
    fixes.push('Remove duplicate describe() blocks - keep only one suite per file');
  }

  if (fixes.length === 0) {
    fixes.push('Describe what you want to change or fix');
    fixes.push('Specify the exact error and how to resolve it');
  }

  return fixes;
}
