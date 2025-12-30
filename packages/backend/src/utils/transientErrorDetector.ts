/**
 * Detect transient (temporary) errors that should be retried automatically
 * These are errors that are likely to succeed if retried after a short delay
 */

export interface TransientErrorResult {
  isTransient: boolean;
  errorType: string;
  suggestedRetryDelay: number; // milliseconds
  maxRetries: number;
  message: string;
}

/**
 * Check if an error is transient and can be automatically retried
 */
export function detectTransientError(error: string | Error): TransientErrorResult {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorLower = errorMessage.toLowerCase();

  // Pattern 1: API Rate Limiting
  if (
    errorLower.includes('rate limit') ||
    errorLower.includes('too many requests') ||
    errorLower.includes('429') ||
    errorLower.includes('quota exceeded')
  ) {
    return {
      isTransient: true,
      errorType: 'rate_limit',
      suggestedRetryDelay: 60000, // 1 minute
      maxRetries: 3,
      message: 'API rate limit exceeded - will retry after delay'
    };
  }

  // Pattern 2: Network Timeouts
  if (
    errorLower.includes('timeout') ||
    errorLower.includes('timed out') ||
    errorLower.includes('etimedout') ||
    errorLower.includes('econnrefused')
  ) {
    return {
      isTransient: true,
      errorType: 'network_timeout',
      suggestedRetryDelay: 5000, // 5 seconds
      maxRetries: 3,
      message: 'Network timeout - will retry'
    };
  }

  // Pattern 3: Temporary Connection Errors
  if (
    errorLower.includes('econnreset') ||
    errorLower.includes('connection reset') ||
    errorLower.includes('socket hang up') ||
    errorLower.includes('epipe')
  ) {
    return {
      isTransient: true,
      errorType: 'connection_error',
      suggestedRetryDelay: 3000, // 3 seconds
      maxRetries: 3,
      message: 'Connection error - will retry'
    };
  }

  // Pattern 4: Service Unavailable
  if (
    errorLower.includes('service unavailable') ||
    errorLower.includes('503') ||
    errorLower.includes('502') ||
    errorLower.includes('bad gateway')
  ) {
    return {
      isTransient: true,
      errorType: 'service_unavailable',
      suggestedRetryDelay: 10000, // 10 seconds
      maxRetries: 3,
      message: 'Service temporarily unavailable - will retry'
    };
  }

  // Pattern 5: Database Lock Errors
  if (
    errorLower.includes('deadlock') ||
    errorLower.includes('lock timeout') ||
    errorLower.includes('could not obtain lock')
  ) {
    return {
      isTransient: true,
      errorType: 'database_lock',
      suggestedRetryDelay: 2000, // 2 seconds
      maxRetries: 5,
      message: 'Database lock detected - will retry'
    };
  }

  // Pattern 6: Temporary File System Errors
  if (
    errorLower.includes('ebusy') ||
    errorLower.includes('file is busy') ||
    (errorLower.includes('enoent') && errorLower.includes('node_modules'))
  ) {
    return {
      isTransient: true,
      errorType: 'filesystem_busy',
      suggestedRetryDelay: 1000, // 1 second
      maxRetries: 3,
      message: 'File system temporarily busy - will retry'
    };
  }

  // Pattern 7: npm/Package Manager Errors
  if (
    errorLower.includes('npm err!') &&
    (errorLower.includes('network') ||
     errorLower.includes('timeout') ||
     errorLower.includes('fetch failed'))
  ) {
    return {
      isTransient: true,
      errorType: 'npm_network',
      suggestedRetryDelay: 5000, // 5 seconds
      maxRetries: 3,
      message: 'npm network error - will retry'
    };
  }

  // Pattern 8: Jest Initialization Errors (sometimes transient)
  if (
    errorLower.includes('jest') &&
    (errorLower.includes('worker') ||
     errorLower.includes('out of memory') ||
     errorLower.includes('heap'))
  ) {
    return {
      isTransient: true,
      errorType: 'jest_memory',
      suggestedRetryDelay: 3000, // 3 seconds
      maxRetries: 2,
      message: 'Jest worker/memory error - will retry'
    };
  }

  // Not a transient error
  return {
    isTransient: false,
    errorType: 'permanent',
    suggestedRetryDelay: 0,
    maxRetries: 0,
    message: 'Non-transient error - requires manual fix'
  };
}

/**
 * Execute a function with automatic retry for transient errors
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number = 3
): Promise<T> {
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      console.log(`[TransientRetry] Attempt ${attempt}/${maxAttempts} for ${operationName}`);
      const result = await operation();

      if (attempt > 1) {
        console.log(`[TransientRetry] ✅ Operation succeeded on attempt ${attempt}`);
      }

      return result;
    } catch (error: any) {
      lastError = error;
      const transientCheck = detectTransientError(error);

      if (!transientCheck.isTransient) {
        // Not transient - throw immediately
        console.log(`[TransientRetry] ❌ Non-transient error detected: ${transientCheck.message}`);
        throw error;
      }

      if (attempt >= maxAttempts) {
        // Max attempts reached
        console.log(`[TransientRetry] ❌ Max attempts (${maxAttempts}) reached for transient error: ${transientCheck.errorType}`);
        throw error;
      }

      // Transient error - retry after delay
      console.log(`[TransientRetry] ⚠️  Transient error detected: ${transientCheck.errorType}`);
      console.log(`[TransientRetry] Waiting ${transientCheck.suggestedRetryDelay}ms before retry...`);

      await new Promise(resolve => setTimeout(resolve, transientCheck.suggestedRetryDelay));
    }
  }

  // Should never reach here, but TypeScript requires it
  throw lastError || new Error('Unknown error in executeWithRetry');
}

/**
 * Create a retry-aware error message
 */
export function formatTransientErrorMessage(
  error: Error | string,
  attempt: number,
  maxAttempts: number
): string {
  const transientCheck = detectTransientError(error);
  const errorMessage = typeof error === 'string' ? error : error.message;

  if (transientCheck.isTransient) {
    return `[Attempt ${attempt}/${maxAttempts}] Transient ${transientCheck.errorType}: ${errorMessage}`;
  }

  return `[Attempt ${attempt}/${maxAttempts}] ${errorMessage}`;
}
