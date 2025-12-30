export interface ErrorContext {
  sessionId: string;
  projectName: string;
  projectPath: string;
  storyTitle?: string;
  testFile?: string;
  phase: 'test_generation' | 'implementation' | 'test_execution' | 'retry';
  attempt?: number;
  maxAttempts?: number;
}

export interface FormattedError {
  title: string;
  message: string;
  context: string[];
  suggestedActions: string[];
  technicalDetails?: string;
  severity: 'critical' | 'error' | 'warning';
}

/**
 * Format error messages with rich context for better debugging
 */
export function formatError(
  error: Error | string,
  context: ErrorContext,
  suggestedActions?: string[]
): FormattedError {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorStack = typeof error === 'string' ? undefined : error.stack;

  // Determine severity based on phase
  let severity: FormattedError['severity'] = 'error';
  if (context.phase === 'test_generation') {
    severity = 'critical'; // Test generation failure is critical
  } else if (context.phase === 'test_execution') {
    severity = 'error'; // Test execution failure is an error
  } else if (context.phase === 'retry') {
    severity = 'warning'; // Retry failures are warnings (expected to some degree)
  }

  // Build context information
  const contextInfo: string[] = [];
  contextInfo.push(`Session: ${context.sessionId}`);
  contextInfo.push(`Project: ${context.projectName} (${context.projectPath})`);
  contextInfo.push(`Phase: ${context.phase}`);

  if (context.storyTitle) {
    contextInfo.push(`Story: ${context.storyTitle}`);
  }

  if (context.testFile) {
    contextInfo.push(`Test File: ${context.testFile}`);
  }

  if (context.attempt && context.maxAttempts) {
    contextInfo.push(`Attempt: ${context.attempt}/${context.maxAttempts}`);
  }

  // Build suggested actions
  const actions: string[] = suggestedActions || [];

  // Add phase-specific suggestions
  if (context.phase === 'test_generation') {
    if (!actions.length) {
      actions.push('Check that the story has clear acceptance criteria');
      actions.push('Verify that the AI prompt includes the PRD and architecture');
      actions.push('Review cursor-agent logs for API errors or rate limiting');
    }
  } else if (context.phase === 'test_execution') {
    if (!actions.length) {
      actions.push('Check test file for syntax errors');
      actions.push('Verify all imports exist or can be scaffolded');
      actions.push('Run npm install to ensure dependencies are installed');
      actions.push('Check jest.config.cjs matches test file location');
    }
  } else if (context.phase === 'implementation') {
    if (!actions.length) {
      actions.push('Review implementation code for errors');
      actions.push('Check that imports match the file structure');
      actions.push('Verify business logic aligns with test expectations');
    }
  }

  // Create title based on error type
  let title = `Error in ${context.phase.replace('_', ' ')}`;
  if (errorMessage.includes('Cannot find module')) {
    title = 'Missing Module Error';
  } else if (errorMessage.includes('SyntaxError')) {
    title = 'Syntax Error';
  } else if (errorMessage.includes('timeout')) {
    title = 'Timeout Error';
  } else if (errorMessage.includes('rate limit')) {
    title = 'API Rate Limit Error';
  }

  return {
    title,
    message: errorMessage,
    context: contextInfo,
    suggestedActions: actions,
    technicalDetails: errorStack,
    severity
  };
}

/**
 * Format error for console logging
 */
export function formatErrorForLogging(formattedError: FormattedError): string {
  const lines: string[] = [];

  const severityIcon = {
    critical: '🚨',
    error: '❌',
    warning: '⚠️'
  };

  lines.push('');
  lines.push('═'.repeat(80));
  lines.push(`${severityIcon[formattedError.severity]} ${formattedError.title.toUpperCase()}`);
  lines.push('═'.repeat(80));
  lines.push('');

  lines.push('📝 MESSAGE:');
  lines.push(`   ${formattedError.message}`);
  lines.push('');

  lines.push('🔍 CONTEXT:');
  formattedError.context.forEach(ctx => {
    lines.push(`   ${ctx}`);
  });
  lines.push('');

  if (formattedError.suggestedActions.length > 0) {
    lines.push('💡 SUGGESTED ACTIONS:');
    formattedError.suggestedActions.forEach((action, idx) => {
      lines.push(`   ${idx + 1}. ${action}`);
    });
    lines.push('');
  }

  if (formattedError.technicalDetails) {
    lines.push('🔧 TECHNICAL DETAILS:');
    lines.push(formattedError.technicalDetails);
    lines.push('');
  }

  lines.push('═'.repeat(80));
  lines.push('');

  return lines.join('\n');
}

/**
 * Create a user-friendly error summary for session completion
 */
export function createSessionErrorSummary(
  sessionId: string,
  errors: FormattedError[],
  successRate: number
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔═══════════════════════════════════════════════════════════════════╗');
  lines.push('║                     SESSION ERROR SUMMARY                         ║');
  lines.push('╚═══════════════════════════════════════════════════════════════════╝');
  lines.push('');

  lines.push(`Session ID: ${sessionId}`);
  lines.push(`Success Rate: ${(successRate * 100).toFixed(1)}%`);
  lines.push(`Total Errors: ${errors.length}`);
  lines.push('');

  // Group errors by severity
  const critical = errors.filter(e => e.severity === 'critical');
  const errorList = errors.filter(e => e.severity === 'error');
  const warnings = errors.filter(e => e.severity === 'warning');

  if (critical.length > 0) {
    lines.push('🚨 CRITICAL ERRORS:');
    critical.forEach((err, idx) => {
      lines.push(`   ${idx + 1}. ${err.title}: ${err.message}`);
    });
    lines.push('');
  }

  if (errorList.length > 0) {
    lines.push('❌ ERRORS:');
    errorList.forEach((err, idx) => {
      lines.push(`   ${idx + 1}. ${err.title}: ${err.message}`);
    });
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('⚠️  WARNINGS:');
    warnings.forEach((err, idx) => {
      lines.push(`   ${idx + 1}. ${err.title}: ${err.message}`);
    });
    lines.push('');
  }

  // Aggregate suggested actions
  const allActions = new Set<string>();
  errors.forEach(err => {
    err.suggestedActions.forEach(action => allActions.add(action));
  });

  if (allActions.size > 0) {
    lines.push('💡 RECOMMENDED NEXT STEPS:');
    Array.from(allActions).forEach((action, idx) => {
      lines.push(`   ${idx + 1}. ${action}`);
    });
    lines.push('');
  }

  lines.push('═'.repeat(71));
  lines.push('');

  return lines.join('\n');
}
