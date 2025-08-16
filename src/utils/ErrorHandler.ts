/**
 * Error context information for detailed error reporting.
 */
export interface ErrorContext {
  /** Request ID for tracing */
  requestId?: string

  /** Operation being performed when error occurred */
  operation?: string

  /** Additional metadata relevant to the error */
  metadata?: Record<string, unknown>

  /** Timestamp when error occurred */
  timestamp?: Date

  /** Component or service where error originated */
  component?: string
}

/**
 * Base application error class for structured error handling.
 *
 * Provides a standardized way to handle errors throughout the application
 * with error codes, HTTP status codes, and contextual information for proper
 * error response handling and debugging.
 *
 * @example
 * ```typescript
 * throw new AppError('Agent not found', 'AGENT_NOT_FOUND', 404, {
 *   requestId: 'req_123',
 *   operation: 'agent_execution',
 *   component: 'AgentManager'
 * })
 * ```
 */
export class AppError extends Error {
  /** Error code for programmatic error identification */
  public readonly code: string

  /** HTTP status code for error response handling */
  public readonly statusCode: number

  /** Context information for debugging and tracing */
  public readonly context: ErrorContext

  /**
   * Creates a new AppError instance.
   *
   * @param message - Human-readable error message
   * @param code - Error code for programmatic identification
   * @param statusCode - HTTP status code (default: 500)
   * @param context - Additional context information
   */
  constructor(message: string, code: string, statusCode = 500, context: ErrorContext = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.context = {
      timestamp: new Date(),
      ...context,
    }

    // Maintains proper stack trace for where error was thrown (Node.js only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Converts error to a structured object for logging or API responses.
   *
   * @returns Structured error object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      stack: this.stack,
    }
  }

  /**
   * Creates a user-friendly error message without sensitive information.
   *
   * @returns User-friendly error message
   */
  toUserMessage(): string {
    return `${this.message} (Error Code: ${this.code})`
  }
}

/**
 * Validation error class for input validation failures.
 *
 * Used when user input fails validation checks such as format validation,
 * required field checks, or constraint violations.
 * Automatically sets HTTP status code to 400 (Bad Request).
 *
 * @example
 * ```typescript
 * throw new ValidationError('Invalid email format', 'INVALID_EMAIL', {
 *   operation: 'user_input_validation',
 *   metadata: { field: 'email', value: 'invalid-email' }
 * })
 * ```
 */
export class ValidationError extends AppError {
  /**
   * Creates a new ValidationError instance.
   *
   * @param message - Description of the validation failure
   * @param code - Error code for the specific validation failure
   * @param context - Additional context information
   */
  constructor(message: string, code: string, context: ErrorContext = {}) {
    super(message, code, 400, {
      component: 'Validation',
      ...context,
    })
  }
}

/**
 * Resource limit error class for resource constraint violations.
 *
 * Used when an operation exceeds allocated resource limits such as
 * memory usage, concurrent executions, or output size.
 * Automatically sets HTTP status code to 429 (Too Many Requests).
 *
 * @example
 * ```typescript
 * throw new ResourceLimitError('Memory usage exceeded 100MB', 'MEMORY_LIMIT_EXCEEDED', 'memory', 100, {
 *   operation: 'agent_execution',
 *   metadata: { currentUsage: 150, agentName: 'test-agent' }
 * })
 * ```
 */
export class ResourceLimitError extends AppError {
  /** The type of resource that was limited */
  public readonly resourceType: string

  /** The limit value that was exceeded */
  public readonly limitValue: number

  /**
   * Creates a new ResourceLimitError instance.
   *
   * @param message - Description of the resource limit violation
   * @param code - Error code for the specific resource limit type
   * @param resourceType - Type of resource (memory, concurrency, output, etc.)
   * @param limitValue - The limit value that was exceeded
   * @param context - Additional context information
   */
  constructor(
    message: string,
    code: string,
    resourceType: string,
    limitValue: number,
    context: ErrorContext = {}
  ) {
    super(message, code, 429, {
      component: 'AgentExecutor',
      metadata: { resourceType, limitValue, ...context.metadata },
      ...context,
    })
    this.resourceType = resourceType
    this.limitValue = limitValue
  }
}

/**
 * File system error class for agent definition loading issues.
 *
 * Used when file system operations fail, such as reading agent definition files,
 * checking file permissions, or handling file I/O errors.
 * Automatically sets HTTP status code to 500 (Internal Server Error).
 *
 * @example
 * ```typescript
 * throw new FileSystemError('Agent definition file not found', 'AGENT_FILE_NOT_FOUND', '/path/to/agent.md', {
 *   operation: 'agent_loading',
 *   metadata: { expectedPath: '/agents/', fileSize: 0 }
 * })
 * ```
 */
export class FileSystemError extends AppError {
  /** The file path that caused the error */
  public readonly filePath: string

  /**
   * Creates a new FileSystemError instance.
   *
   * @param message - Description of the file system error
   * @param code - Error code for the specific file system issue
   * @param filePath - The file path that caused the error
   * @param context - Additional context information
   */
  constructor(message: string, code: string, filePath: string, context: ErrorContext = {}) {
    super(message, code, 500, {
      component: 'FileSystem',
      metadata: { filePath, ...context.metadata },
      ...context,
    })
    this.filePath = filePath
  }
}

/**
 * MCP protocol error class for MCP communication issues.
 *
 * Used when MCP protocol communication fails, such as invalid requests,
 * protocol violations, or transport errors.
 * Automatically sets HTTP status code to 502 (Bad Gateway).
 *
 * @example
 * ```typescript
 * throw new MCPProtocolError('Invalid MCP request format', 'INVALID_MCP_REQUEST', 'tools/run_agent', {
 *   operation: 'mcp_tool_execution',
 *   metadata: { toolName: 'run_agent', requestId: 'req_123' }
 * })
 * ```
 */
export class MCPProtocolError extends AppError {
  /** The MCP context where the error occurred */
  public readonly mcpContext: string

  /**
   * Creates a new MCPProtocolError instance.
   *
   * @param message - Description of the MCP protocol error
   * @param code - Error code for the specific protocol issue
   * @param mcpContext - The MCP context where the error occurred
   * @param context - Additional context information
   */
  constructor(message: string, code: string, mcpContext: string, context: ErrorContext = {}) {
    super(message, code, 502, {
      component: 'MCPProtocol',
      metadata: { mcpContext, ...context.metadata },
      ...context,
    })
    this.mcpContext = mcpContext
  }
}

/**
 * Error recovery strategies for handling different types of failures.
 */
export interface ErrorRecoveryStrategy {
  /** Maximum number of retry attempts */
  maxRetries: number

  /** Base delay between retries in milliseconds */
  baseDelayMs: number

  /** Exponential backoff multiplier */
  backoffMultiplier: number

  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number

  /** Function to determine if error is recoverable */
  isRecoverable: (error: Error) => boolean

  /** Optional cleanup function to call before retry */
  cleanup?: () => Promise<void>
}

/**
 * Default error recovery strategies for different error types.
 */
export const DEFAULT_RECOVERY_STRATEGIES: Record<string, ErrorRecoveryStrategy> = {
  resource_limit: {
    maxRetries: 3,
    baseDelayMs: 500,
    backoffMultiplier: 1.5,
    maxDelayMs: 5000,
    isRecoverable: (error) =>
      error instanceof ResourceLimitError &&
      (error as ResourceLimitError).resourceType === 'concurrency',
  },
  file_system: {
    maxRetries: 2,
    baseDelayMs: 100,
    backoffMultiplier: 2,
    maxDelayMs: 2000,
    isRecoverable: (error) => error instanceof FileSystemError && !error.code.includes('NOT_FOUND'),
  },
  network: {
    maxRetries: 5,
    baseDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    isRecoverable: (error) =>
      error instanceof MCPProtocolError && !error.code.includes('INVALID_REQUEST'),
  },
}

/**
 * Error boundary for isolating component failures and preventing cascade failures.
 */
export class ErrorBoundary {
  private readonly componentName: string
  private readonly recoveryStrategies: Record<string, ErrorRecoveryStrategy>
  private readonly errorCounts: Map<string, number> = new Map()

  /**
   * Creates a new ErrorBoundary instance.
   *
   * @param componentName - Name of the component being protected
   * @param recoveryStrategies - Custom recovery strategies (uses defaults if not provided)
   */
  constructor(
    componentName: string,
    recoveryStrategies: Record<string, ErrorRecoveryStrategy> = DEFAULT_RECOVERY_STRATEGIES
  ) {
    this.componentName = componentName
    this.recoveryStrategies = recoveryStrategies
  }

  /**
   * Executes an operation with error boundary protection and recovery.
   *
   * @param operation - The operation to execute
   * @param operationName - Name of the operation for error tracking
   * @returns Promise that resolves to the operation result
   * @throws {Error} When operation fails after all recovery attempts
   */
  async execute<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    const errorKey = `${this.componentName}:${operationName}`
    let lastError: Error

    // First, try the operation without any retry strategy
    try {
      const result = await operation()
      return result
    } catch (error) {
      lastError = error as Error
    }

    // Then try recovery strategies for recoverable errors
    for (const [strategyName, strategy] of Object.entries(this.recoveryStrategies)) {
      if (!strategy.isRecoverable(lastError)) {
        continue
      }

      const retryKey = `${errorKey}:${strategyName}`

      for (let retryCount = 0; retryCount < strategy.maxRetries; retryCount++) {
        // Calculate delay with exponential backoff
        const delay = Math.min(
          strategy.baseDelayMs * strategy.backoffMultiplier ** retryCount,
          strategy.maxDelayMs
        )

        // Perform cleanup if provided
        if (strategy.cleanup) {
          try {
            await strategy.cleanup()
          } catch (cleanupError) {
            console.error(`Cleanup failed for ${errorKey}:`, cleanupError)
          }
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay))

        try {
          const result = await operation()
          // Reset error count on success
          this.errorCounts.delete(retryKey)
          return result
        } catch (error) {
          lastError = error as Error

          // Update error count
          this.errorCounts.set(retryKey, retryCount + 1)

          // If the error type changed, it might not be recoverable by this strategy
          if (!strategy.isRecoverable(lastError)) {
            break
          }
        }
      }

      // If we have a recoverable strategy but still failed, stop trying other strategies
      break
    }

    // All recovery strategies exhausted, throw the last error
    throw lastError!
  }

  /**
   * Gets error statistics for monitoring.
   *
   * @returns Error count statistics
   */
  getErrorStats(): Record<string, number> {
    const stats: Record<string, number> = {}
    for (const [key, count] of this.errorCounts.entries()) {
      stats[key] = count
    }
    return stats
  }

  /**
   * Resets error counts for all operations.
   */
  resetErrorCounts(): void {
    this.errorCounts.clear()
  }

  /**
   * Gets the component name protected by this boundary.
   *
   * @returns Component name
   */
  getComponentName(): string {
    return this.componentName
  }
}
