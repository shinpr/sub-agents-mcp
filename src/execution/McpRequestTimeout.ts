import { type LogLevel, Logger } from 'src/utils/Logger'

/**
 * Configuration for MCP request timeout management
 * Following MCP specification recommendations for handling long-running LLM operations
 */
export interface McpTimeoutConfig {
  /**
   * Default timeout for MCP requests in milliseconds
   * Considering LLM processing characteristics, set to 2 minutes by default
   */
  defaultTimeoutMs: number

  /**
   * Maximum absolute timeout in milliseconds
   * Prevents infinite waiting even with progress updates (5 minutes by default)
   */
  maxTimeoutMs: number

  /**
   * Whether to reset timeout when progress notification is received
   * Recommended by MCP specification for long-running operations
   */
  progressResetEnabled: boolean

  /**
   * Warning threshold in milliseconds
   * Sends progress notification to improve UX (1 minute by default)
   */
  warningThresholdMs: number

  /**
   * Enable debug logging for timeout operations
   */
  enableDebugLogging: boolean
}

/**
 * Default timeout configuration for MCP requests
 * Based on MCP best practices and LLM operation characteristics
 */
export const DEFAULT_MCP_TIMEOUT_CONFIG: McpTimeoutConfig = {
  defaultTimeoutMs: 120000, // 2 minutes - considering LLM processing time
  maxTimeoutMs: 300000, // 5 minutes - absolute maximum
  progressResetEnabled: true,
  warningThresholdMs: 60000, // 1 minute - send progress notification
  enableDebugLogging: false,
}

/**
 * Progress notification data for MCP requests
 */
export interface ProgressNotification {
  requestId: string
  message: string
  percentage?: number
  timestamp: number
}

/**
 * Timeout context for tracking request execution
 */
export interface TimeoutContext {
  requestId: string
  startTime: number
  currentTimeout: NodeJS.Timeout | null
  warningTimeout: NodeJS.Timeout | null
  maxTimeout: NodeJS.Timeout | null
  progressCount: number
  lastProgressTime: number
  isCompleted: boolean
  isCancelled: boolean
  onTimeout?: TimeoutCallback
  onProgress?: ProgressCallback
}

/**
 * Callback for handling timeout events
 */
export type TimeoutCallback = (context: TimeoutContext) => void

/**
 * Callback for sending progress notifications
 */
export type ProgressCallback = (notification: ProgressNotification) => void

/**
 * McpRequestTimeout manages timeout behavior for MCP server requests
 * Implements MCP specification recommendations for handling long-running operations
 *
 * This class handles AI -> MCP level timeouts, separate from MCP -> AI (AgentExecutor) timeouts
 * Following MCP best practices:
 * - Progressive timeout with reset on progress
 * - Maximum absolute timeout enforcement
 * - Progress notifications for better UX
 * - Graceful cancellation support
 */
export class McpRequestTimeout {
  private readonly config: McpTimeoutConfig
  private readonly logger: Logger
  private readonly contexts: Map<string, TimeoutContext> = new Map()

  /**
   * Creates a new McpRequestTimeout instance
   *
   * @param config - Optional timeout configuration
   * @param logger - Optional logger instance
   */
  constructor(config?: Partial<McpTimeoutConfig>, logger?: Logger) {
    this.config = { ...DEFAULT_MCP_TIMEOUT_CONFIG, ...config }
    this.logger = logger || new Logger((process.env['LOG_LEVEL'] as LogLevel) || 'info')
  }

  /**
   * Start timeout tracking for a request
   *
   * @param requestId - Unique request identifier
   * @param onTimeout - Callback when timeout occurs
   * @param onProgress - Optional callback for progress notifications
   * @returns TimeoutContext for the request
   */
  startTimeout(
    requestId: string,
    onTimeout: TimeoutCallback,
    onProgress?: ProgressCallback
  ): TimeoutContext {
    // Clear any existing timeout for this request
    this.clearTimeout(requestId)

    const context: TimeoutContext = {
      requestId,
      startTime: Date.now(),
      currentTimeout: null,
      warningTimeout: null,
      maxTimeout: null,
      progressCount: 0,
      lastProgressTime: Date.now(),
      isCompleted: false,
      isCancelled: false,
      onTimeout,
      ...(onProgress && { onProgress }),
    }

    // Set warning timeout (for progress notification)
    if (onProgress && this.config.warningThresholdMs > 0) {
      context.warningTimeout = setTimeout(() => {
        if (!context.isCompleted && !context.isCancelled) {
          this.sendProgressNotification(
            context,
            onProgress,
            'Processing is taking longer than expected'
          )
        }
      }, this.config.warningThresholdMs)
    }

    // Set default timeout
    context.currentTimeout = setTimeout(() => {
      if (!context.isCompleted && !context.isCancelled) {
        this.handleTimeout(context, onTimeout)
      }
    }, this.config.defaultTimeoutMs)

    // Set maximum absolute timeout (cannot be reset)
    context.maxTimeout = setTimeout(() => {
      if (!context.isCompleted && !context.isCancelled) {
        this.logger.warn('Maximum timeout reached, forcing termination', {
          requestId,
          elapsedMs: Date.now() - context.startTime,
          maxTimeoutMs: this.config.maxTimeoutMs,
        })
        this.handleTimeout(context, onTimeout)
      }
    }, this.config.maxTimeoutMs)

    this.contexts.set(requestId, context)

    if (this.config.enableDebugLogging) {
      this.logger.debug('Timeout tracking started', {
        requestId,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        maxTimeoutMs: this.config.maxTimeoutMs,
      })
    }

    return context
  }

  /**
   * Report progress and optionally reset timeout
   * Following MCP specification: MAY reset timeout on progress, but enforce maximum
   *
   * @param requestId - Request identifier
   * @param message - Progress message
   * @param percentage - Optional completion percentage
   */
  reportProgress(requestId: string, message: string, percentage?: number): void {
    const context = this.contexts.get(requestId)
    if (!context || context.isCompleted || context.isCancelled) {
      return
    }

    context.progressCount++
    context.lastProgressTime = Date.now()

    if (this.config.enableDebugLogging) {
      this.logger.debug('Progress reported', {
        requestId,
        message,
        percentage,
        progressCount: context.progressCount,
        elapsedMs: Date.now() - context.startTime,
      })
    }

    // Reset timeout if enabled (but maximum timeout remains)
    if (this.config.progressResetEnabled && context.currentTimeout) {
      clearTimeout(context.currentTimeout)

      // Calculate remaining time before max timeout
      const elapsedMs = Date.now() - context.startTime
      const remainingMs = this.config.maxTimeoutMs - elapsedMs
      const newTimeoutMs = Math.min(this.config.defaultTimeoutMs, remainingMs)

      if (newTimeoutMs > 0 && context.onTimeout) {
        context.currentTimeout = setTimeout(() => {
          if (!context.isCompleted && !context.isCancelled) {
            this.handleTimeout(context, context.onTimeout!)
          }
        }, newTimeoutMs)

        this.logger.info('Timeout reset due to progress', {
          requestId,
          newTimeoutMs,
          remainingBeforeMaxMs: remainingMs,
        })
      }
    }
  }

  /**
   * Mark request as completed and clear timeouts
   *
   * @param requestId - Request identifier
   */
  complete(requestId: string): void {
    const context = this.contexts.get(requestId)
    if (!context) {
      return
    }

    context.isCompleted = true
    this.clearTimeouts(context)

    const totalTime = Date.now() - context.startTime
    this.logger.info('Request completed within timeout', {
      requestId,
      totalTimeMs: totalTime,
      progressCount: context.progressCount,
    })

    this.contexts.delete(requestId)
  }

  /**
   * Cancel request and clear timeouts
   * Following MCP specification for cancellation
   *
   * @param requestId - Request identifier
   * @param reason - Cancellation reason
   */
  cancel(requestId: string, reason: string): void {
    const context = this.contexts.get(requestId)
    if (!context) {
      return
    }

    context.isCancelled = true
    this.clearTimeouts(context)

    this.logger.info('Request cancelled', {
      requestId,
      reason,
      elapsedMs: Date.now() - context.startTime,
    })

    this.contexts.delete(requestId)
  }

  /**
   * Clear timeout for a request
   *
   * @param requestId - Request identifier
   */
  clearTimeout(requestId: string): void {
    const context = this.contexts.get(requestId)
    if (context) {
      this.clearTimeouts(context)
      this.contexts.delete(requestId)
    }
  }

  /**
   * Check if request has timed out
   *
   * @param requestId - Request identifier
   * @returns true if timed out
   */
  hasTimedOut(requestId: string): boolean {
    const context = this.contexts.get(requestId)
    if (!context) {
      return false
    }

    const elapsedMs = Date.now() - context.startTime
    return elapsedMs >= this.config.maxTimeoutMs
  }

  /**
   * Get timeout statistics for monitoring
   *
   * @returns Current timeout statistics
   */
  getStats(): {
    activeRequests: number
    averageProgressCount: number
    longestRunningMs: number
  } {
    const activeContexts = Array.from(this.contexts.values()).filter(
      (c) => !c.isCompleted && !c.isCancelled
    )

    const now = Date.now()
    const longestRunningMs = activeContexts.reduce((max, c) => Math.max(max, now - c.startTime), 0)

    const averageProgressCount =
      activeContexts.length > 0
        ? activeContexts.reduce((sum, c) => sum + c.progressCount, 0) / activeContexts.length
        : 0

    return {
      activeRequests: activeContexts.length,
      averageProgressCount,
      longestRunningMs,
    }
  }

  /**
   * Handle timeout event
   *
   * @private
   */
  private handleTimeout(context: TimeoutContext, onTimeout: TimeoutCallback): void {
    const elapsedMs = Date.now() - context.startTime

    this.logger.warn('Request timeout occurred', {
      requestId: context.requestId,
      elapsedMs,
      progressCount: context.progressCount,
      lastProgressMs: Date.now() - context.lastProgressTime,
    })

    onTimeout(context)
    this.clearTimeouts(context)
  }

  /**
   * Send progress notification
   *
   * @private
   */
  private sendProgressNotification(
    context: TimeoutContext,
    onProgress: ProgressCallback,
    message: string
  ): void {
    const notification: ProgressNotification = {
      requestId: context.requestId,
      message,
      timestamp: Date.now(),
    }

    onProgress(notification)
  }

  /**
   * Clear all timeouts for a context
   *
   * @private
   */
  private clearTimeouts(context: TimeoutContext): void {
    if (context.currentTimeout) {
      clearTimeout(context.currentTimeout)
      context.currentTimeout = null
    }
    if (context.warningTimeout) {
      clearTimeout(context.warningTimeout)
      context.warningTimeout = null
    }
    if (context.maxTimeout) {
      clearTimeout(context.maxTimeout)
      context.maxTimeout = null
    }
  }
}
