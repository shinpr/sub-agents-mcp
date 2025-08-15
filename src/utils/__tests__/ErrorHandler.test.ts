import {
  AppError,
  DEFAULT_RECOVERY_STRATEGIES,
  ErrorBoundary,
  FileSystemError,
  MCPProtocolError,
  ResourceLimitError,
  TimeoutError,
  ValidationError,
} from 'src/utils/ErrorHandler'
import { describe, expect, it, vi } from 'vitest'

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
    expect(error.context.component).toBe('Validation')
  })

  it('should support validation errors with context', () => {
    const error = new ValidationError('Email format is invalid', 'INVALID_EMAIL_FORMAT', {
      operation: 'user_registration',
      metadata: { field: 'email', value: 'invalid@' },
    })

    expect(error.context.operation).toBe('user_registration')
    expect(error.context.metadata?.field).toBe('email')
    expect(error.context.component).toBe('Validation')
  })
})

describe('TimeoutError', () => {
  it('should create timeout error with timeout duration', () => {
    const error = new TimeoutError('Execution exceeded time limit', 'EXECUTION_TIMEOUT', 30000)

    expect(error.message).toBe('Execution exceeded time limit')
    expect(error.code).toBe('EXECUTION_TIMEOUT')
    expect(error.statusCode).toBe(408)
    expect(error.timeoutMs).toBe(30000)
    expect(error.name).toBe('TimeoutError')
    expect(error).toBeInstanceOf(AppError)
  })

  it('should handle different timeout durations', () => {
    const shortTimeout = new TimeoutError('Quick timeout', 'QUICK_TIMEOUT', 5000)
    const longTimeout = new TimeoutError('Long timeout', 'LONG_TIMEOUT', 60000)

    expect(shortTimeout.timeoutMs).toBe(5000)
    expect(longTimeout.timeoutMs).toBe(60000)
  })
})

describe('ResourceLimitError', () => {
  it('should create resource limit error with resource details', () => {
    const error = new ResourceLimitError(
      'Memory usage exceeded limit',
      'MEMORY_LIMIT_EXCEEDED',
      'memory',
      100
    )

    expect(error.message).toBe('Memory usage exceeded limit')
    expect(error.code).toBe('MEMORY_LIMIT_EXCEEDED')
    expect(error.statusCode).toBe(429)
    expect(error.resourceType).toBe('memory')
    expect(error.limitValue).toBe(100)
    expect(error.name).toBe('ResourceLimitError')
    expect(error).toBeInstanceOf(AppError)
  })

  it('should handle different resource types', () => {
    const memoryError = new ResourceLimitError('Memory limit', 'MEMORY_LIMIT', 'memory', 100)
    const concurrencyError = new ResourceLimitError(
      'Too many executions',
      'CONCURRENCY_LIMIT',
      'concurrency',
      5
    )
    const outputError = new ResourceLimitError(
      'Output too large',
      'OUTPUT_LIMIT',
      'output_size',
      1048576
    )

    expect(memoryError.resourceType).toBe('memory')
    expect(concurrencyError.resourceType).toBe('concurrency')
    expect(outputError.resourceType).toBe('output_size')
  })
})

describe('FileSystemError', () => {
  it('should create file system error with file path', () => {
    const error = new FileSystemError(
      'Agent definition file not found',
      'AGENT_FILE_NOT_FOUND',
      '/path/to/agent.md'
    )

    expect(error.message).toBe('Agent definition file not found')
    expect(error.code).toBe('AGENT_FILE_NOT_FOUND')
    expect(error.statusCode).toBe(500)
    expect(error.filePath).toBe('/path/to/agent.md')
    expect(error.name).toBe('FileSystemError')
    expect(error).toBeInstanceOf(AppError)
  })

  it('should handle different file paths', () => {
    const configError = new FileSystemError('Config not found', 'CONFIG_NOT_FOUND', 'config.json')
    const agentError = new FileSystemError(
      'Agent not found',
      'AGENT_NOT_FOUND',
      'agents/test-agent.md'
    )

    expect(configError.filePath).toBe('config.json')
    expect(agentError.filePath).toBe('agents/test-agent.md')
  })
})

describe('MCPProtocolError', () => {
  it('should create MCP protocol error with context', () => {
    const error = new MCPProtocolError(
      'Invalid MCP request format',
      'INVALID_MCP_REQUEST',
      'tools/run_agent'
    )

    expect(error.message).toBe('Invalid MCP request format')
    expect(error.code).toBe('INVALID_MCP_REQUEST')
    expect(error.statusCode).toBe(502)
    expect(error.mcpContext).toBe('tools/run_agent')
    expect(error.name).toBe('MCPProtocolError')
    expect(error).toBeInstanceOf(AppError)
  })

  it('should handle different MCP contexts', () => {
    const toolError = new MCPProtocolError('Tool error', 'TOOL_ERROR', 'tools/run_agent')
    const resourceError = new MCPProtocolError(
      'Resource error',
      'RESOURCE_ERROR',
      'resources/agents'
    )

    expect(toolError.mcpContext).toBe('tools/run_agent')
    expect(resourceError.mcpContext).toBe('resources/agents')
  })
})

describe('Enhanced Error Features', () => {
  it('should provide JSON serialization', () => {
    const error = new AppError('Test error', 'TEST_ERROR', 400, {
      requestId: 'req_123',
      operation: 'test_operation',
    })

    const json = error.toJSON()

    expect(json.name).toBe('AppError')
    expect(json.message).toBe('Test error')
    expect(json.code).toBe('TEST_ERROR')
    expect(json.statusCode).toBe(400)
    expect(json.context).toMatchObject({
      requestId: 'req_123',
      operation: 'test_operation',
    })
    expect(json.stack).toBeDefined()
  })

  it('should provide user-friendly messages', () => {
    const error = new AppError('Internal server error', 'INTERNAL_ERROR')

    expect(error.toUserMessage()).toBe('Internal server error (Error Code: INTERNAL_ERROR)')
  })

  it('should automatically add timestamp to context', () => {
    const beforeTime = new Date()
    const error = new AppError('Test error', 'TEST_ERROR')
    const afterTime = new Date()

    expect(error.context.timestamp).toBeInstanceOf(Date)
    expect(error.context.timestamp!.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
    expect(error.context.timestamp!.getTime()).toBeLessThanOrEqual(afterTime.getTime())
  })
})

describe('Error Classification and Propagation', () => {
  it('should properly classify timeout errors in execution context', () => {
    // This test expects TimeoutError to be thrown when execution exceeds limit
    const createTimeoutError = () => {
      throw new TimeoutError('Agent execution exceeded 30 seconds', 'EXECUTION_TIMEOUT', 30000)
    }

    expect(createTimeoutError).toThrow(TimeoutError)
    expect(createTimeoutError).toThrow('Agent execution exceeded 30 seconds')
  })

  it('should properly classify resource limit errors', () => {
    // This test expects ResourceLimitError to be thrown when limits exceeded
    const createResourceError = () => {
      throw new ResourceLimitError(
        'Maximum concurrent executions exceeded',
        'CONCURRENCY_LIMIT_EXCEEDED',
        'concurrency',
        5
      )
    }

    expect(createResourceError).toThrow(ResourceLimitError)
    expect(createResourceError).toThrow('Maximum concurrent executions exceeded')
  })

  it('should maintain error context through component layers', () => {
    // Test error context preservation
    const originalError = new FileSystemError(
      'Agent file not found',
      'AGENT_FILE_NOT_FOUND',
      '/agents/test.md'
    )

    expect(originalError.filePath).toBe('/agents/test.md')
    expect(originalError.code).toBe('AGENT_FILE_NOT_FOUND')
    expect(originalError.statusCode).toBe(500)
    expect(originalError.context.component).toBe('FileSystem')
  })

  it('should support enhanced error context in all error types', () => {
    const timeoutError = new TimeoutError('Timeout', 'TIMEOUT', 30000, {
      requestId: 'req_123',
      operation: 'agent_execution',
    })

    expect(timeoutError.context.requestId).toBe('req_123')
    expect(timeoutError.context.component).toBe('TimeoutManager')
    expect(timeoutError.context.metadata?.timeoutMs).toBe(30000)
  })
})

describe('ErrorBoundary', () => {
  let errorBoundary: ErrorBoundary

  beforeEach(() => {
    errorBoundary = new ErrorBoundary('TestComponent')
  })

  it('should execute operation successfully without retries', async () => {
    const operation = vi.fn().mockResolvedValue('success')

    const result = await errorBoundary.execute(operation, 'test_operation')

    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('should retry on recoverable errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError('Timeout', 'TIMEOUT', 5000))
      .mockResolvedValue('success')

    const result = await errorBoundary.execute(operation, 'test_operation')

    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('should not retry on non-recoverable errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new ValidationError('Invalid input', 'VALIDATION_ERROR'))

    await expect(errorBoundary.execute(operation, 'test_operation')).rejects.toThrow(
      ValidationError
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('should respect maximum retry limits', async () => {
    const operation = vi.fn().mockRejectedValue(new TimeoutError('Timeout', 'TIMEOUT', 5000))

    await expect(errorBoundary.execute(operation, 'test_operation')).rejects.toThrow(TimeoutError)

    // Should have tried 1 original + 2 retries = 3 times (timeout strategy maxRetries: 2)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('should track error statistics', async () => {
    const operation = vi.fn().mockRejectedValue(new TimeoutError('Timeout', 'TIMEOUT', 5000))

    try {
      await errorBoundary.execute(operation, 'test_operation')
    } catch (error) {
      // Expected to fail after all retries
    }

    const stats = errorBoundary.getErrorStats()
    expect(Object.keys(stats)).toContain('TestComponent:test_operation:timeout')
  })

  it('should reset error counts', async () => {
    const operation = vi.fn().mockRejectedValue(new TimeoutError('Timeout', 'TIMEOUT', 5000))

    try {
      await errorBoundary.execute(operation, 'test_operation')
    } catch (error) {
      // Expected to fail
    }

    errorBoundary.resetErrorCounts()
    const stats = errorBoundary.getErrorStats()
    expect(Object.keys(stats)).toHaveLength(0)
  })

  it('should handle cleanup functions', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const customStrategies = {
      timeout: {
        ...DEFAULT_RECOVERY_STRATEGIES.timeout,
        cleanup,
      },
    }

    const customBoundary = new ErrorBoundary('TestComponent', customStrategies)
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError('Timeout', 'TIMEOUT', 5000))
      .mockResolvedValue('success')

    const result = await customBoundary.execute(operation, 'test_operation')

    expect(result).toBe('success')
    expect(cleanup).toHaveBeenCalled()
  })

  it('should return component name', () => {
    expect(errorBoundary.getComponentName()).toBe('TestComponent')
  })
})

describe('Recovery Strategies', () => {
  it('should have proper default recovery strategies', () => {
    expect(DEFAULT_RECOVERY_STRATEGIES.timeout.maxRetries).toBe(2)
    expect(DEFAULT_RECOVERY_STRATEGIES.resource_limit.maxRetries).toBe(3)
    expect(DEFAULT_RECOVERY_STRATEGIES.file_system.maxRetries).toBe(2)
    expect(DEFAULT_RECOVERY_STRATEGIES.network.maxRetries).toBe(5)
  })

  it('should identify recoverable timeout errors', () => {
    const timeoutError = new TimeoutError('Timeout', 'TIMEOUT', 5000)
    const validationError = new ValidationError('Invalid', 'INVALID')

    expect(DEFAULT_RECOVERY_STRATEGIES.timeout.isRecoverable(timeoutError)).toBe(true)
    expect(DEFAULT_RECOVERY_STRATEGIES.timeout.isRecoverable(validationError)).toBe(false)
  })

  it('should identify recoverable resource limit errors', () => {
    const concurrencyError = new ResourceLimitError(
      'Too many',
      'CONCURRENCY_LIMIT',
      'concurrency',
      5
    )
    const memoryError = new ResourceLimitError('Memory', 'MEMORY_LIMIT', 'memory', 100)

    expect(DEFAULT_RECOVERY_STRATEGIES.resource_limit.isRecoverable(concurrencyError)).toBe(true)
    expect(DEFAULT_RECOVERY_STRATEGIES.resource_limit.isRecoverable(memoryError)).toBe(false)
  })
})
