export interface ErrorContext {
  requestId?: string

  operation?: string

  metadata?: Record<string, unknown>

  timestamp?: Date

  component?: string
}

export interface AppErrorOptions extends ErrorOptions {
  code: string

  statusCode?: number

  context?: ErrorContext
}

export class AppError extends Error {
  public readonly code: string

  public readonly statusCode: number

  public readonly context: ErrorContext

  constructor(message: string, options: AppErrorOptions) {
    super(message, { cause: options.cause })
    this.name = this.constructor.name
    this.code = options.code
    this.statusCode = options.statusCode ?? 500
    this.context = {
      timestamp: new Date(),
      ...options.context,
    }

    // Maintains proper stack trace for where error was thrown (Node.js only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

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

  toUserMessage(): string {
    return `${this.message} (Error Code: ${this.code})`
  }
}

export type ValidationErrorOptions = Omit<AppErrorOptions, 'statusCode'>

export class ValidationError extends AppError {
  constructor(message: string, options: ValidationErrorOptions) {
    super(message, {
      ...options,
      statusCode: 400,
      context: {
        component: 'Validation',
        ...options.context,
      },
    })
  }
}

/**
 * Safely converts an unknown thrown value into a human-readable message.
 * Avoids relying on the default `Object.prototype.toString` (`[object Object]`)
 * for values that do not define a meaningful string representation.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint' ||
    typeof error === 'symbol' ||
    error === null ||
    error === undefined
  ) {
    return String(error)
  }
  try {
    return JSON.stringify(error) ?? 'Unknown error'
  } catch {
    return 'Unknown error'
  }
}
