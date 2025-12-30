/**
 * TDD Metrics Collection and Analysis
 * Tracks success rates, performance, and error patterns
 */

export interface TDDSessionMetrics {
  sessionId: string;
  projectId: string;
  storyId: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;

  // Test generation metrics
  testsGenerated: number;
  testsValid: number;
  testGenerationDuration?: number;

  // Implementation metrics
  implementationAttempts: number;
  implementationDuration?: number;

  // Test execution metrics
  totalTests: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  successRate: number;

  // Retry metrics
  totalRetries: number;
  retriesSuccessful: number;
  retryBudgetSpent: number;
  retryBudgetTotal: number;

  // Error metrics
  errorTypes: Record<string, number>;
  mostCommonError?: string;

  // Phase durations
  phaseDurations: {
    testGeneration?: number;
    implementation?: number;
    testExecution?: number;
    retry?: number;
  };

  // Final status
  status: 'completed' | 'failed' | 'in_progress';
  failureReason?: string;
}

export interface AggregatedMetrics {
  totalSessions: number;
  successfulSessions: number;
  failedSessions: number;
  overallSuccessRate: number;

  // Average metrics
  avgTestsPerSession: number;
  avgDuration: number;
  avgRetries: number;
  avgSuccessRate: number;

  // Error analysis
  totalErrors: number;
  errorTypeDistribution: Record<string, number>;
  topErrors: Array<{ type: string; count: number; percentage: number }>;

  // Performance percentiles
  durationP50: number;
  durationP95: number;
  durationP99: number;

  // Time period
  periodStart: Date;
  periodEnd: Date;
}

export class TDDMetricsCollector {
  private metrics: Map<string, TDDSessionMetrics>;

  constructor() {
    this.metrics = new Map();
  }

  /**
   * Initialize metrics for a new session
   */
  initSession(sessionId: string, projectId: string, storyId: string): void {
    this.metrics.set(sessionId, {
      sessionId,
      projectId,
      storyId,
      startedAt: new Date(),
      testsGenerated: 0,
      testsValid: 0,
      implementationAttempts: 0,
      totalTests: 0,
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      successRate: 0,
      totalRetries: 0,
      retriesSuccessful: 0,
      retryBudgetSpent: 0,
      retryBudgetTotal: 15,
      errorTypes: {},
      phaseDurations: {},
      status: 'in_progress'
    });
  }

  /**
   * Record test generation results
   */
  recordTestGeneration(
    sessionId: string,
    testsGenerated: number,
    testsValid: number,
    duration: number
  ): void {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return;

    metrics.testsGenerated = testsGenerated;
    metrics.testsValid = testsValid;
    metrics.testGenerationDuration = duration;
    metrics.phaseDurations.testGeneration = duration;
  }

  /**
   * Record implementation attempt
   */
  recordImplementation(sessionId: string, duration: number): void {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return;

    metrics.implementationAttempts++;
    metrics.implementationDuration = (metrics.implementationDuration || 0) + duration;
    metrics.phaseDurations.implementation = metrics.implementationDuration;
  }

  /**
   * Record test execution results
   */
  recordTestExecution(
    sessionId: string,
    total: number,
    passed: number,
    failed: number,
    skipped: number,
    duration: number
  ): void {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return;

    metrics.totalTests = total;
    metrics.testsPassed = passed;
    metrics.testsFailed = failed;
    metrics.testsSkipped = skipped;
    metrics.successRate = total > 0 ? (passed / total) * 100 : 0;
    metrics.phaseDurations.testExecution = (metrics.phaseDurations.testExecution || 0) + duration;
  }

  /**
   * Record retry attempt
   */
  recordRetry(
    sessionId: string,
    budgetCost: number,
    successful: boolean,
    duration: number
  ): void {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return;

    metrics.totalRetries++;
    metrics.retryBudgetSpent += budgetCost;
    if (successful) {
      metrics.retriesSuccessful++;
    }
    metrics.phaseDurations.retry = (metrics.phaseDurations.retry || 0) + duration;
  }

  /**
   * Record error occurrence
   */
  recordError(sessionId: string, errorType: string): void {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return;

    metrics.errorTypes[errorType] = (metrics.errorTypes[errorType] || 0) + 1;

    // Update most common error
    const errors = Object.entries(metrics.errorTypes);
    if (errors.length > 0) {
      const sorted = errors.sort((a, b) => b[1] - a[1]);
      metrics.mostCommonError = sorted[0][0];
    }
  }

  /**
   * Complete a session
   */
  completeSession(
    sessionId: string,
    status: 'completed' | 'failed',
    failureReason?: string
  ): void {
    const metrics = this.metrics.get(sessionId);
    if (!metrics) return;

    metrics.completedAt = new Date();
    metrics.duration = metrics.completedAt.getTime() - metrics.startedAt.getTime();
    metrics.status = status;
    metrics.failureReason = failureReason;
  }

  /**
   * Get metrics for a specific session
   */
  getSessionMetrics(sessionId: string): TDDSessionMetrics | undefined {
    return this.metrics.get(sessionId);
  }

  /**
   * Get aggregated metrics for all sessions
   */
  getAggregatedMetrics(
    periodStart?: Date,
    periodEnd?: Date
  ): AggregatedMetrics {
    const allMetrics = Array.from(this.metrics.values());

    // Filter by time period if specified
    let filteredMetrics = allMetrics;
    if (periodStart || periodEnd) {
      filteredMetrics = allMetrics.filter(m => {
        const sessionTime = m.startedAt.getTime();
        if (periodStart && sessionTime < periodStart.getTime()) return false;
        if (periodEnd && sessionTime > periodEnd.getTime()) return false;
        return true;
      });
    }

    const totalSessions = filteredMetrics.length;
    const successfulSessions = filteredMetrics.filter(m => m.status === 'completed').length;
    const failedSessions = filteredMetrics.filter(m => m.status === 'failed').length;

    // Calculate averages
    const avgTestsPerSession = totalSessions > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.totalTests, 0) / totalSessions
      : 0;

    const completedMetrics = filteredMetrics.filter(m => m.duration !== undefined);
    const avgDuration = completedMetrics.length > 0
      ? completedMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / completedMetrics.length
      : 0;

    const avgRetries = totalSessions > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.totalRetries, 0) / totalSessions
      : 0;

    const avgSuccessRate = totalSessions > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.successRate, 0) / totalSessions
      : 0;

    // Aggregate error types
    const errorTypeDistribution: Record<string, number> = {};
    let totalErrors = 0;

    filteredMetrics.forEach(m => {
      Object.entries(m.errorTypes).forEach(([type, count]) => {
        errorTypeDistribution[type] = (errorTypeDistribution[type] || 0) + count;
        totalErrors += count;
      });
    });

    // Top errors
    const topErrors = Object.entries(errorTypeDistribution)
      .map(([type, count]) => ({
        type,
        count,
        percentage: totalErrors > 0 ? (count / totalErrors) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Duration percentiles
    const sortedDurations = completedMetrics
      .map(m => m.duration || 0)
      .sort((a, b) => a - b);

    const durationP50 = this.percentile(sortedDurations, 50);
    const durationP95 = this.percentile(sortedDurations, 95);
    const durationP99 = this.percentile(sortedDurations, 99);

    return {
      totalSessions,
      successfulSessions,
      failedSessions,
      overallSuccessRate: totalSessions > 0 ? (successfulSessions / totalSessions) * 100 : 0,
      avgTestsPerSession,
      avgDuration,
      avgRetries,
      avgSuccessRate,
      totalErrors,
      errorTypeDistribution,
      topErrors,
      durationP50,
      durationP95,
      durationP99,
      periodStart: periodStart || new Date(0),
      periodEnd: periodEnd || new Date()
    };
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(): string {
    const allMetrics = Array.from(this.metrics.values());
    return JSON.stringify(allMetrics, null, 2);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }
}

/**
 * Global metrics collector instance
 */
export const globalMetricsCollector = new TDDMetricsCollector();

/**
 * Format metrics for display
 */
export function formatMetricsReport(metrics: AggregatedMetrics): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('                   TDD METRICS REPORT                      ');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  lines.push('📊 OVERALL STATISTICS:');
  lines.push(`  Total Sessions: ${metrics.totalSessions}`);
  lines.push(`  Successful: ${metrics.successfulSessions} (${metrics.overallSuccessRate.toFixed(1)}%)`);
  lines.push(`  Failed: ${metrics.failedSessions}`);
  lines.push('');

  lines.push('📈 AVERAGES:');
  lines.push(`  Tests per Session: ${metrics.avgTestsPerSession.toFixed(1)}`);
  lines.push(`  Duration: ${(metrics.avgDuration / 1000 / 60).toFixed(1)} minutes`);
  lines.push(`  Retries: ${metrics.avgRetries.toFixed(1)}`);
  lines.push(`  Success Rate: ${metrics.avgSuccessRate.toFixed(1)}%`);
  lines.push('');

  lines.push('⏱️  PERFORMANCE (Duration):');
  lines.push(`  P50 (median): ${(metrics.durationP50 / 1000 / 60).toFixed(1)} min`);
  lines.push(`  P95: ${(metrics.durationP95 / 1000 / 60).toFixed(1)} min`);
  lines.push(`  P99: ${(metrics.durationP99 / 1000 / 60).toFixed(1)} min`);
  lines.push('');

  if (metrics.topErrors.length > 0) {
    lines.push('🐛 TOP ERRORS:');
    metrics.topErrors.slice(0, 5).forEach((error, idx) => {
      lines.push(`  ${idx + 1}. ${error.type}: ${error.count} (${error.percentage.toFixed(1)}%)`);
    });
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}
