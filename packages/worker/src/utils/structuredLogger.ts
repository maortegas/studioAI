/**
 * Structured Logger for TDD System
 * Provides consistent, queryable logging with levels, context, and metadata
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL'
}

export interface LogContext {
  sessionId?: string;
  projectId?: string;
  projectName?: string;
  storyId?: string;
  testSuiteId?: string;
  phase?: string;
  component?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  metadata?: Record<string, any>;
  duration?: number;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export class StructuredLogger {
  private component: string;
  private defaultContext: LogContext;

  constructor(component: string, defaultContext: LogContext = {}) {
    this.component = component;
    this.defaultContext = defaultContext;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): StructuredLogger {
    return new StructuredLogger(this.component, {
      ...this.defaultContext,
      ...additionalContext
    });
  }

  /**
   * Log a debug message
   */
  debug(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log an info message
   */
  info(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log a warning
   */
  warn(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log an error
   */
  error(message: string, error?: Error | string, metadata?: Record<string, any>): void {
    const errorInfo = typeof error === 'string'
      ? { message: error }
      : error
        ? { message: error.message, stack: error.stack }
        : undefined;

    this.log(LogLevel.ERROR, message, metadata, undefined, errorInfo);
  }

  /**
   * Log a fatal error
   */
  fatal(message: string, error?: Error | string, metadata?: Record<string, any>): void {
    const errorInfo = typeof error === 'string'
      ? { message: error }
      : error
        ? { message: error.message, stack: error.stack }
        : undefined;

    this.log(LogLevel.FATAL, message, metadata, undefined, errorInfo);
  }

  /**
   * Log the start of an operation (returns function to log completion)
   */
  startOperation(operationName: string, metadata?: Record<string, any>): () => void {
    const startTime = Date.now();
    this.info(`Starting: ${operationName}`, metadata);

    return () => {
      const duration = Date.now() - startTime;
      this.info(`Completed: ${operationName}`, { ...metadata, duration });
    };
  }

  /**
   * Log a metric
   */
  metric(metricName: string, value: number, unit?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, `Metric: ${metricName}`, {
      ...metadata,
      metric: metricName,
      value,
      unit
    });
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, any>,
    duration?: number,
    error?: { message: string; stack?: string; code?: string }
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...this.defaultContext,
        component: this.component
      },
      metadata,
      duration,
      error
    };

    // Format output based on environment
    if (process.env.LOG_FORMAT === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      this.formatConsoleOutput(entry);
    }
  }

  /**
   * Format log entry for console output
   */
  private formatConsoleOutput(entry: LogEntry): void {
    const icons = {
      [LogLevel.DEBUG]: '🔍',
      [LogLevel.INFO]: '✅',
      [LogLevel.WARN]: '⚠️',
      [LogLevel.ERROR]: '❌',
      [LogLevel.FATAL]: '🚨'
    };

    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.FATAL]: '\x1b[35m'  // Magenta
    };

    const reset = '\x1b[0m';
    const icon = icons[entry.level];
    const color = colors[entry.level];

    // Build context string
    const contextParts: string[] = [];
    if (entry.context?.component) {
      contextParts.push(entry.context.component);
    }
    if (entry.context?.sessionId) {
      contextParts.push(`session:${entry.context.sessionId.substring(0, 8)}`);
    }
    if (entry.context?.phase) {
      contextParts.push(`phase:${entry.context.phase}`);
    }

    const contextStr = contextParts.length > 0 ? `[${contextParts.join('|')}]` : '';

    // Build message
    let output = `${color}${icon} ${entry.level}${reset} ${contextStr} ${entry.message}`;

    // Add duration if present
    if (entry.duration !== undefined) {
      output += ` ${color}(${entry.duration}ms)${reset}`;
    }

    console.log(output);

    // Log metadata if present
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      console.log(`  📊 Metadata:`, entry.metadata);
    }

    // Log error if present
    if (entry.error) {
      console.error(`  💥 Error: ${entry.error.message}`);
      if (entry.error.stack) {
        console.error(`  Stack: ${entry.error.stack}`);
      }
    }
  }
}

/**
 * Global logger factory
 */
export function createLogger(component: string, context: LogContext = {}): StructuredLogger {
  return new StructuredLogger(component, context);
}

/**
 * Performance tracking helper
 */
export class PerformanceTracker {
  private logger: StructuredLogger;
  private operations: Map<string, number>;

  constructor(logger: StructuredLogger) {
    this.logger = logger;
    this.operations = new Map();
  }

  /**
   * Start tracking an operation
   */
  start(operationName: string): void {
    this.operations.set(operationName, Date.now());
  }

  /**
   * End tracking and log duration
   */
  end(operationName: string, metadata?: Record<string, any>): void {
    const startTime = this.operations.get(operationName);
    if (!startTime) {
      this.logger.warn(`Performance tracking: operation "${operationName}" was not started`);
      return;
    }

    const duration = Date.now() - startTime;
    this.logger.metric(operationName, duration, 'ms', metadata);
    this.operations.delete(operationName);
  }

  /**
   * Wrap a function with performance tracking
   */
  wrap<T>(operationName: string, fn: () => T | Promise<T>): Promise<T> {
    this.start(operationName);
    const result = fn();

    if (result instanceof Promise) {
      return result.finally(() => this.end(operationName));
    }

    this.end(operationName);
    return Promise.resolve(result);
  }
}
