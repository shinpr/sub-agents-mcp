import { type LogEntry, type LogLevel, Logger, createLogger } from 'src/utils/Logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Logger', () => {
  let logger: Logger
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger = new Logger('info')
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('Log Level Management', () => {
    it('should set and get log level correctly', () => {
      // Act & Assert
      expect(logger.getLevel()).toBe('info')

      logger.setLevel('debug')
      expect(logger.getLevel()).toBe('debug')

      logger.setLevel('error')
      expect(logger.getLevel()).toBe('error')
    })

    it('should filter logs based on level hierarchy', () => {
      // Arrange
      logger.setLevel('warn')

      // Act
      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warning message')
      logger.error('Error message')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(2) // Only warn and error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
    })

    it('should log all levels when set to debug', () => {
      // Arrange
      logger.setLevel('debug')

      // Act
      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warning message')
      logger.error('Error message')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(4)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: Debug message'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('INFO: Info message'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
    })

    it('should only log errors when set to error level', () => {
      // Arrange
      logger.setLevel('error')

      // Act
      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warning message')
      logger.error('Error message')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
    })
  })

  describe('Structured Logging', () => {
    it('should log messages with timestamp and level', () => {
      // Act
      logger.info('Test message')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const logCall = consoleSpy.mock.calls[0][0] as string
      expect(logCall).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] INFO: Test message$/
      )
    })

    it('should include context data when provided', () => {
      // Arrange
      const context = { userId: '123', action: 'test' }

      // Act
      logger.info('Test with context', context)

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('INFO: Test with context'),
        context
      )
    })

    it('should handle empty context gracefully', () => {
      // Act
      logger.info('Test message', {})

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('INFO: Test message')
      expect(context).toBeUndefined() // Empty context should not be passed
    })

    it('should not log context when not provided', () => {
      // Act
      logger.info('Simple message')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy.mock.calls[0]).toHaveLength(1) // Only message, no context
    })
  })

  describe('Error Logging', () => {
    it('should log error messages with error object', () => {
      // Arrange
      const error = new Error('Test error')

      // Act
      logger.error('Error occurred', error)

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('ERROR: Error occurred')
      expect(context).toMatchObject({
        error: 'Test error',
        stack: expect.any(String),
      })
    })

    it('should log error with both error object and additional context', () => {
      // Arrange
      const error = new Error('Test error')
      const additionalContext = { operation: 'file-read', filePath: '/test/file.txt' }

      // Act
      logger.error('File operation failed', error, additionalContext)

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('ERROR: File operation failed')
      expect(context).toMatchObject({
        operation: 'file-read',
        filePath: '/test/file.txt',
        error: 'Test error',
        stack: expect.any(String),
      })
    })

    it('should log error without error object when not provided', () => {
      // Act
      logger.error('Error without exception')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('ERROR: Error without exception')
      expect(context).toBeUndefined()
    })
  })

  describe('Log Methods', () => {
    it('should provide debug logging method', () => {
      // Arrange
      logger.setLevel('debug')

      // Act
      logger.debug('Debug information', { component: 'test' })

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: Debug information'), {
        component: 'test',
      })
    })

    it('should provide info logging method', () => {
      // Act
      logger.info('Information message', { status: 'success' })

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('INFO: Information message'),
        { status: 'success' }
      )
    })

    it('should provide warn logging method', () => {
      // Act
      logger.warn('Warning message', { warning: 'deprecated-api' })

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'), {
        warning: 'deprecated-api',
      })
    })
  })

  describe('Constructor and Factory', () => {
    it('should use default info level when no level provided', () => {
      // Arrange
      const defaultLogger = new Logger()

      // Assert
      expect(defaultLogger.getLevel()).toBe('info')
    })

    it('should accept custom level in constructor', () => {
      // Arrange
      const debugLogger = new Logger('debug')
      const errorLogger = new Logger('error')

      // Assert
      expect(debugLogger.getLevel()).toBe('debug')
      expect(errorLogger.getLevel()).toBe('error')
    })

    it('should create logger with factory function', () => {
      // Act
      const factoryLogger = createLogger('warn')

      // Assert
      expect(factoryLogger.getLevel()).toBe('warn')
      expect(factoryLogger).toBeInstanceOf(Logger)
    })

    it('should create logger with default level via factory', () => {
      // Act
      const defaultFactoryLogger = createLogger()

      // Assert
      expect(defaultFactoryLogger.getLevel()).toBe('info')
    })
  })

  describe('Timestamp Formatting', () => {
    it('should use ISO timestamp format', () => {
      // Act
      logger.info('Timestamp test')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const logMessage = consoleSpy.mock.calls[0][0] as string
      const timestampMatch = logMessage.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
      expect(timestampMatch).toBeTruthy()

      const timestamp = timestampMatch![1]
      expect(() => new Date(timestamp)).not.toThrow()
    })

    it('should have consistent timestamp format across multiple logs', () => {
      // Act
      logger.info('First message')
      logger.warn('Second message')

      // Assert
      expect(consoleSpy).toHaveBeenCalledTimes(2)
      const firstLog = consoleSpy.mock.calls[0][0] as string
      const secondLog = consoleSpy.mock.calls[1][0] as string

      const timestampRegex = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/
      expect(firstLog).toMatch(timestampRegex)
      expect(secondLog).toMatch(timestampRegex)
    })
  })
})
