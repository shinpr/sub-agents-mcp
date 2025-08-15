import { describe, it, expect } from 'vitest'
import { 
  AppError, 
  ValidationError, 
  BusinessRuleError, 
  DatabaseError, 
  ExternalServiceError 
} from '../../src/utils/ErrorHandler'

describe('AppError', () => {
  it('should create error with message, code, and statusCode', () => {
    // This test will fail until we implement the ErrorHandler classes
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
  })
})

describe('BusinessRuleError', () => {
  it('should create business rule error with 400 status code', () => {
    const error = new BusinessRuleError('Business rule violation', 'RULE_VIOLATION')

    expect(error.message).toBe('Business rule violation')
    expect(error.code).toBe('RULE_VIOLATION')
    expect(error.statusCode).toBe(400)
    expect(error.name).toBe('BusinessRuleError')
    expect(error).toBeInstanceOf(AppError)
  })
})

describe('DatabaseError', () => {
  it('should create database error with 500 status code', () => {
    const error = new DatabaseError('Database connection failed', 'DB_CONNECTION_FAILED')

    expect(error.message).toBe('Database connection failed')
    expect(error.code).toBe('DB_CONNECTION_FAILED')
    expect(error.statusCode).toBe(500)
    expect(error.name).toBe('DatabaseError')
    expect(error).toBeInstanceOf(AppError)
  })
})

describe('ExternalServiceError', () => {
  it('should create external service error with 502 status code', () => {
    const error = new ExternalServiceError('External API is unavailable', 'EXTERNAL_API_DOWN')

    expect(error.message).toBe('External API is unavailable')
    expect(error.code).toBe('EXTERNAL_API_DOWN')
    expect(error.statusCode).toBe(502)
    expect(error.name).toBe('ExternalServiceError')
    expect(error).toBeInstanceOf(AppError)
  })

  it('should handle timeout errors', () => {
    const error = new ExternalServiceError('Request timeout', 'REQUEST_TIMEOUT')

    expect(error.message).toBe('Request timeout')
    expect(error.code).toBe('REQUEST_TIMEOUT')
  })
})