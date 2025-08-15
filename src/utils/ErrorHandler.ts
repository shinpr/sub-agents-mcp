/**
 * Base application error class for structured error handling.
 *
 * Provides a standardized way to handle errors throughout the application
 * with error codes and HTTP status codes for proper error response handling.
 *
 * @example
 * ```typescript
 * throw new AppError('Agent not found', 'AGENT_NOT_FOUND', 404)
 * ```
 */
export class AppError extends Error {
  /** Error code for programmatic error identification */
  public readonly code: string

  /** HTTP status code for error response handling */
  public readonly statusCode: number

  /**
   * Creates a new AppError instance.
   *
   * @param message - Human-readable error message
   * @param code - Error code for programmatic identification
   * @param statusCode - HTTP status code (default: 500)
   */
  constructor(message: string, code: string, statusCode = 500) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode

    // Maintains proper stack trace for where error was thrown (Node.js only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
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
 * throw new ValidationError('Invalid email format', 'INVALID_EMAIL')
 * ```
 */
export class ValidationError extends AppError {
  /**
   * Creates a new ValidationError instance.
   *
   * @param message - Description of the validation failure
   * @param code - Error code for the specific validation failure
   */
  constructor(message: string, code: string) {
    super(message, code, 400)
  }
}

/**
 * Business rule error class for business logic violations.
 *
 * Used when operations violate business rules or domain constraints,
 * such as attempting to perform an action that is not allowed
 * in the current state or context.
 * Automatically sets HTTP status code to 400 (Bad Request).
 *
 * @example
 * ```typescript
 * throw new BusinessRuleError('Cannot delete agent that is currently running', 'AGENT_IN_USE')
 * ```
 */
export class BusinessRuleError extends AppError {
  /**
   * Creates a new BusinessRuleError instance.
   *
   * @param message - Description of the business rule violation
   * @param code - Error code for the specific business rule violation
   */
  constructor(message: string, code: string) {
    super(message, code, 400)
  }
}

/**
 * Database error class for database-related failures.
 *
 * Used when database operations fail due to connection issues,
 * query errors, or data consistency problems.
 * Automatically sets HTTP status code to 500 (Internal Server Error).
 *
 * @example
 * ```typescript
 * throw new DatabaseError('Failed to connect to database', 'DB_CONNECTION_FAILED')
 * ```
 */
export class DatabaseError extends AppError {
  /**
   * Creates a new DatabaseError instance.
   *
   * @param message - Description of the database failure
   * @param code - Error code for the specific database error
   */
  constructor(message: string, code: string) {
    super(message, code, 500)
  }
}

/**
 * External service error class for external API or service failures.
 *
 * Used when external service calls fail due to network issues,
 * service unavailability, or API errors.
 * Automatically sets HTTP status code to 502 (Bad Gateway).
 *
 * @example
 * ```typescript
 * throw new ExternalServiceError('Claude API is unavailable', 'CLAUDE_API_DOWN')
 * ```
 */
export class ExternalServiceError extends AppError {
  /**
   * Creates a new ExternalServiceError instance.
   *
   * @param message - Description of the external service failure
   * @param code - Error code for the specific external service error
   */
  constructor(message: string, code: string) {
    super(message, code, 502)
  }
}
