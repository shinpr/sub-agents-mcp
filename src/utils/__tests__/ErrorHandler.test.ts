import { AppError, ValidationError } from 'src/utils/ErrorHandler'
import { describe, expect, it } from 'vitest'

describe('AppError', () => {
  it('should create error with message, code, and statusCode', () => {
    const error = new AppError('Test error message', 'TEST_ERROR', 400)

    expect(error.message).toBe('Test error message')
    expect(error.code).toBe('TEST_ERROR')
    expect(error.statusCode).toBe(400)
    expect(error.name).toBe('AppError')
    expect(error).toBeInstanceOf(Error)
  })

  it('should use default statusCode 500 when not provided', () => {
    const error = new AppError('Server error', 'SERVER_ERROR')

    expect(error.statusCode).toBe(500)
  })

  it('should be instance of Error', () => {
    const error = new AppError('Test', 'TEST')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AppError)
  })
})

describe('ValidationError', () => {
  it('should create validation error with 400 status code', () => {
    const error = new ValidationError('Invalid input data', 'VALIDATION_FAILED')

    expect(error.message).toBe('Invalid input data')
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.statusCode).toBe(400)
    expect(error.name).toBe('ValidationError')
    expect(error).toBeInstanceOf(AppError)
  })

  it('should support field-specific validation errors', () => {
    const error = new ValidationError('Email format is invalid', 'INVALID_EMAIL_FORMAT')

    expect(error.message).toBe('Email format is invalid')
    expect(error.code).toBe('INVALID_EMAIL_FORMAT')
    expect(error.statusCode).toBe(400)
  })

  it('should include context information', () => {
    const error = new ValidationError('Email format is invalid', 'INVALID_EMAIL_FORMAT', {
      metadata: { field: 'email', value: 'invalid-email' },
    })

    expect(error.context.metadata).toEqual({ field: 'email', value: 'invalid-email' })
    expect(error.context.component).toBe('Validation')
  })
})

describe('Error Context', () => {
  it('should include timestamp by default', () => {
    const error = new AppError('Test error', 'TEST')

    expect(error.context.timestamp).toBeInstanceOf(Date)
  })

  it('should merge custom context with defaults', () => {
    const customContext = {
      requestId: 'req_123',
      operation: 'test_operation',
      component: 'TestComponent',
    }

    const error = new AppError('Test error', 'TEST', 500, customContext)

    expect(error.context.requestId).toBe('req_123')
    expect(error.context.operation).toBe('test_operation')
    expect(error.context.component).toBe('TestComponent')
    expect(error.context.timestamp).toBeInstanceOf(Date)
  })

  it('should preserve metadata in context', () => {
    const error = new AppError('Test error', 'TEST', 500, {
      metadata: { key1: 'value1', key2: 42 },
    })

    expect(error.context.metadata).toEqual({ key1: 'value1', key2: 42 })
  })
})

describe('Error JSON Serialization', () => {
  it('should convert AppError to JSON', () => {
    const error = new AppError('Test error', 'TEST_ERROR', 400, {
      requestId: 'req_123',
      metadata: { foo: 'bar' },
    })

    const json = error.toJSON()

    expect(json).toMatchObject({
      name: 'AppError',
      message: 'Test error',
      code: 'TEST_ERROR',
      statusCode: 400,
      context: expect.objectContaining({
        requestId: 'req_123',
        metadata: { foo: 'bar' },
      }),
    })
  })

  it('should generate user-friendly message', () => {
    const error = new AppError('Internal server error', 'INTERNAL_ERROR', 500)
    const userMessage = error.toUserMessage()

    expect(userMessage).toBe('Internal server error (Error Code: INTERNAL_ERROR)')
  })
})
