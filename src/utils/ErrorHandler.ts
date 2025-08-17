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
