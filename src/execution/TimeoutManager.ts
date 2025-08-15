/**
 * Timeout management for agent execution with configurable limits and cleanup.
 *
 * Provides timeout enforcement with warning mechanisms, graceful cleanup,
 * and integration with agent execution processes.
 */

import { TimeoutError } from 'src/utils/ErrorHandler'

/**
 * Configuration interface for timeout management.
 */
export interface TimeoutConfig {
  /** Default timeout in milliseconds (default: 30000) */
  defaultTimeoutMs: number

  /** Warning threshold as percentage of timeout (default: 0.8 for 80%) */
  warningThresholdPercent: number

  /** Enable timeout warnings (default: true) */
  enableWarnings: boolean

  /** Grace period for cleanup in milliseconds (default: 5000) */
  cleanupGracePeriodMs: number
}

/**
 * Timeout execution context for tracking active operations.
 */
export interface TimeoutContext {
  /** Unique identifier for the operation */
  operationId: string

  /** Start time of the operation */
  startTime: Date

  /** Timeout duration in milliseconds */
  timeoutMs: number

  /** Warning callback function */
  onWarning?: (remainingMs: number) => void

  /** Cleanup callback function */
  onCleanup?: () => Promise<void>
}

/**
 * Default timeout configuration.
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultTimeoutMs: 30000, // 30 seconds
  warningThresholdPercent: 0.8, // 80%
  enableWarnings: true,
  cleanupGracePeriodMs: 5000, // 5 seconds
}

/**
 * Timeout manager for execution time monitoring and enforcement.
 *
 * Manages timeout enforcement with configurable limits, warning mechanisms,
 * and graceful cleanup for agent execution processes.
 */
export class TimeoutManager {
  private readonly config: TimeoutConfig
  private readonly activeTimeouts: Map<
    string,
    {
      timer: NodeJS.Timeout
      warningTimer: NodeJS.Timeout | undefined
      context: TimeoutContext
    }
  > = new Map()

  /**
   * Creates a new TimeoutManager instance.
   *
   * @param config - Timeout configuration (uses defaults if not provided)
   */
  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config }
  }

  /**
   * Starts timeout monitoring for an operation.
   *
   * @param context - Timeout context for the operation
   * @returns Operation ID for tracking
   * @throws {Error} If operation ID is already being tracked
   */
  startTimeout(context: TimeoutContext): string {
    if (this.activeTimeouts.has(context.operationId)) {
      throw new Error(`Timeout already active for operation: ${context.operationId}`)
    }

    // Set up warning timer if enabled and warning callback provided
    let warningTimer: NodeJS.Timeout | undefined
    if (this.config.enableWarnings && context.onWarning) {
      const warningDelayMs = context.timeoutMs * this.config.warningThresholdPercent
      warningTimer = setTimeout(() => {
        const elapsed = Date.now() - context.startTime.getTime()
        const remaining = context.timeoutMs - elapsed
        context.onWarning?.(remaining)
      }, warningDelayMs)
    }

    // Set up main timeout timer
    const timer = setTimeout(async () => {
      await this.handleTimeout(context)
    }, context.timeoutMs)

    this.activeTimeouts.set(context.operationId, {
      timer,
      warningTimer,
      context,
    })

    return context.operationId
  }

  /**
   * Clears timeout monitoring for an operation.
   *
   * @param operationId - Operation ID to clear
   * @returns True if timeout was cleared, false if not found
   */
  clearTimeout(operationId: string): boolean {
    const timeoutData = this.activeTimeouts.get(operationId)
    if (!timeoutData) {
      return false
    }

    // Update statistics for successful completion
    this.updateStats(operationId, true)

    clearTimeout(timeoutData.timer)
    if (timeoutData.warningTimer) {
      clearTimeout(timeoutData.warningTimer)
    }

    this.activeTimeouts.delete(operationId)
    return true
  }

  /**
   * Gets the remaining time for an operation.
   *
   * @param operationId - Operation ID to check
   * @returns Remaining time in milliseconds, or null if not found
   */
  getRemainingTime(operationId: string): number | null {
    const timeoutData = this.activeTimeouts.get(operationId)
    if (!timeoutData) {
      return null
    }

    const elapsed = Date.now() - timeoutData.context.startTime.getTime()
    const remaining = timeoutData.context.timeoutMs - elapsed
    return Math.max(0, remaining)
  }

  /**
   * Gets the elapsed time for an operation.
   *
   * @param operationId - Operation ID to check
   * @returns Elapsed time in milliseconds, or null if not found
   */
  getElapsedTime(operationId: string): number | null {
    const timeoutData = this.activeTimeouts.get(operationId)
    if (!timeoutData) {
      return null
    }

    return Date.now() - timeoutData.context.startTime.getTime()
  }

  /**
   * Checks if an operation is currently being tracked.
   *
   * @param operationId - Operation ID to check
   * @returns True if operation is being tracked
   */
  isActive(operationId: string): boolean {
    return this.activeTimeouts.has(operationId)
  }

  /**
   * Gets all active operation IDs.
   *
   * @returns Array of active operation IDs
   */
  getActiveOperations(): string[] {
    return Array.from(this.activeTimeouts.keys())
  }

  /**
   * Creates a timeout context with default values.
   *
   * @param operationId - Unique operation identifier
   * @param timeoutMs - Timeout duration (uses default if not provided)
   * @param options - Additional context options
   * @returns Timeout context
   */
  createContext(
    operationId: string,
    timeoutMs?: number,
    options: {
      onWarning?: (remainingMs: number) => void
      onCleanup?: () => Promise<void>
    } = {}
  ): TimeoutContext {
    const context: TimeoutContext = {
      operationId,
      startTime: new Date(),
      timeoutMs: timeoutMs ?? this.config.defaultTimeoutMs,
    }

    if (options.onWarning) {
      context.onWarning = options.onWarning
    }

    if (options.onCleanup) {
      context.onCleanup = options.onCleanup
    }

    return context
  }

  /**
   * Gets the current configuration.
   *
   * @returns Timeout configuration
   */
  getConfig(): TimeoutConfig {
    return { ...this.config }
  }

  /**
   * Clears all active timeouts.
   *
   * @returns Number of timeouts cleared
   */
  clearAllTimeouts(): number {
    const count = this.activeTimeouts.size
    for (const [operationId] of this.activeTimeouts) {
      this.clearTimeout(operationId)
    }
    return count
  }

  /**
   * Gets timeout statistics for monitoring and optimization.
   *
   * @returns Timeout statistics
   */
  getTimeoutStats(): {
    activeOperations: number
    totalOperationsStarted: number
    averageCompletionTime: number
    timeoutRate: number
  } {
    return {
      activeOperations: this.activeTimeouts.size,
      totalOperationsStarted: this.stats.totalOperations,
      averageCompletionTime:
        this.stats.totalCompletions > 0
          ? this.stats.totalCompletionTime / this.stats.totalCompletions
          : 0,
      timeoutRate:
        this.stats.totalOperations > 0 ? this.stats.totalTimeouts / this.stats.totalOperations : 0,
    }
  }

  /**
   * Suggests optimal timeout based on historical data.
   *
   * @param operationType - Type of operation for historical analysis (reserved for future use)
   * @returns Suggested timeout in milliseconds
   */
  suggestOptimalTimeout(operationType = 'default'): number {
    // operationType is reserved for future use when we implement operation-specific timeouts
    void operationType
    const stats = this.getTimeoutStats()
    const baseTimeout = this.config.defaultTimeoutMs

    // If no historical data, use default
    if (stats.averageCompletionTime === 0) {
      return baseTimeout
    }

    // Add buffer based on completion time and timeout rate
    const bufferMultiplier = 1 + stats.timeoutRate * 2 // More buffer for higher timeout rates
    const suggestedTimeout = stats.averageCompletionTime * bufferMultiplier

    // Ensure it's within reasonable bounds
    return Math.max(Math.min(suggestedTimeout, baseTimeout * 3), baseTimeout * 0.5)
  }

  /**
   * Updates timeout statistics.
   *
   * @param operationId - Operation that completed/timed out
   * @param completed - Whether operation completed successfully
   * @private
   */
  private updateStats(operationId: string, completed: boolean): void {
    const timeoutData = this.activeTimeouts.get(operationId)
    if (!timeoutData) return

    this.stats.totalOperations++

    if (completed) {
      this.stats.totalCompletions++
      const completionTime = Date.now() - timeoutData.context.startTime.getTime()
      this.stats.totalCompletionTime += completionTime
    } else {
      this.stats.totalTimeouts++
    }
  }

  /**
   * Handles timeout event with cleanup and error throwing.
   *
   * @param context - Timeout context
   * @private
   */
  private async handleTimeout(context: TimeoutContext): Promise<void> {
    // Update statistics
    this.updateStats(context.operationId, false)

    // Remove from active timeouts
    this.activeTimeouts.delete(context.operationId)

    // Perform cleanup if provided
    if (context.onCleanup) {
      try {
        // Give cleanup a grace period
        const cleanupPromise = context.onCleanup()
        const cleanupTimeout = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Cleanup timeout exceeded'))
          }, this.config.cleanupGracePeriodMs)
        })

        await Promise.race([cleanupPromise, cleanupTimeout])
      } catch (cleanupError) {
        // Log cleanup error but don't prevent timeout error from being thrown
        console.error(`Cleanup failed for operation ${context.operationId}:`, cleanupError)
      }
    }

    // Throw timeout error with enhanced context
    const elapsed = Date.now() - context.startTime.getTime()
    throw new TimeoutError(
      `Operation timed out after ${elapsed}ms (limit: ${context.timeoutMs}ms)`,
      'EXECUTION_TIMEOUT',
      context.timeoutMs,
      {
        operation: 'timeout_handling',
        metadata: {
          operationId: context.operationId,
          actualDuration: elapsed,
          configuredTimeout: context.timeoutMs,
        },
      }
    )
  }

  /**
   * Statistics tracking for timeout optimization.
   * @private
   */
  private stats = {
    totalOperations: 0,
    totalCompletions: 0,
    totalCompletionTime: 0,
    totalTimeouts: 0,
  }
}
