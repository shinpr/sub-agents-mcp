export interface ErrorContext {
  requestId?: string

  operation?: string

  metadata?: Record<string, unknown>

  timestamp?: Date

  component?: string
}

export class AppError extends Error {
  public readonly code: string

  public readonly statusCode: number

  public readonly context: ErrorContext

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

export class ValidationError extends AppError {
  constructor(message: string, code: string, context: ErrorContext = {}) {
    super(message, code, 400, {
      component: 'Validation',
      ...context,
    })
  }
}
