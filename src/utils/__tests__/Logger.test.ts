import { type LogEntry, type LogLevel, Logger } from 'src/utils/Logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Logger', () => {
  let logger: Logger
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger = new Logger('info')
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('Log Level Management', () => {
    it('should filter logs below warn level when created with warn level', () => {
      // Arrange
      const warnLogger = new Logger('warn')
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      warnLogger.debug('Debug message')
      warnLogger.info('Info message')
      warnLogger.warn('Warning message')
      warnLogger.error('Error message')

      // Assert - focus on behavior: only warn and error messages appear
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG:'))
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('INFO:'))

      warnSpy.mockRestore()
    })

    it('should log all levels when created with debug level', () => {
      // Arrange
      const debugLogger = new Logger('debug')
      const debugSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      debugLogger.debug('Debug message')
      debugLogger.info('Info message')
      debugLogger.warn('Warning message')
      debugLogger.error('Error message')

      // Assert - focus on behavior: all message types appear
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: Debug message'))
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('INFO: Info message'))
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'))
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))

      debugSpy.mockRestore()
    })

    it('should only log errors when created with error level', () => {
      // Arrange
      const errorLogger = new Logger('error')
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      errorLogger.debug('Debug message')
      errorLogger.info('Info message')
      errorLogger.warn('Warning message')
      errorLogger.error('Error message')

      // Assert - focus on behavior: only error messages appear
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG:'))
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('INFO:'))
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('WARN:'))

      errorSpy.mockRestore()
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

  describe('Constructor', () => {
    it('should use default info level when no level provided', () => {
      // Arrange
      const defaultLogger = new Logger()
      const infoSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act - info should log, debug should not
      defaultLogger.debug('Debug msg')
      defaultLogger.info('Info msg')

      // Assert - focus on behavior: info logs, debug does not
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('INFO: Info msg'))
      expect(infoSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG:'))

      infoSpy.mockRestore()
    })

    it('should accept custom level in constructor', () => {
      // Arrange
      const debugLogger = new Logger('debug')
      const errorLogger = new Logger('error')
      const debugSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      debugLogger.debug('Debug from debug logger')
      errorLogger.debug('Debug from error logger')
      errorLogger.error('Error from error logger')

      // Assert - focus on behavior: debug logger logs debug, error logger only logs error
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG: Debug from debug logger')
      )
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('ERROR: Error from error logger')
      )
      // error logger should NOT log debug messages
      expect(debugSpy).not.toHaveBeenCalledWith(expect.stringContaining('Debug from error logger'))

      debugSpy.mockRestore()
    })
  })
})
