import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '../Logger.js'

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
      const warnLogger = new Logger('warn')
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      warnLogger.debug('Debug message')
      warnLogger.info('Info message')
      warnLogger.warn('Warning message')
      warnLogger.error('Error message')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG:'))
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('INFO:'))

      warnSpy.mockRestore()
    })

    it('should log all levels when created with debug level', () => {
      const debugLogger = new Logger('debug')
      const debugSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      debugLogger.debug('Debug message')
      debugLogger.info('Info message')
      debugLogger.warn('Warning message')
      debugLogger.error('Error message')

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: Debug message'))
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('INFO: Info message'))
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('WARN: Warning message'))
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))

      debugSpy.mockRestore()
    })

    it('should only log errors when created with error level', () => {
      const errorLogger = new Logger('error')
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      errorLogger.debug('Debug message')
      errorLogger.info('Info message')
      errorLogger.warn('Warning message')
      errorLogger.error('Error message')

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: Error message'))
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG:'))
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('INFO:'))
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('WARN:'))

      errorSpy.mockRestore()
    })
  })

  describe('Structured Logging', () => {
    it('should log messages with timestamp and level', () => {
      logger.info('Test message')

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const logCall = consoleSpy.mock.calls[0][0] as string
      expect(logCall).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] INFO: Test message$/
      )
    })

    it('should include context data when provided', () => {
      const context = { userId: '123', action: 'test' }

      logger.info('Test with context', context)

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('INFO: Test with context'),
        context
      )
    })

    it('should handle empty context gracefully', () => {
      logger.info('Test message', {})

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('INFO: Test message')
      expect(context).toBeUndefined() // Empty context should not be passed
    })

    it('should not log context when not provided', () => {
      logger.info('Simple message')

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy.mock.calls[0]).toHaveLength(1) // Only message, no context
    })
  })

  describe('Error Logging', () => {
    it('should log error messages with error object', () => {
      const error = new Error('Test error')

      logger.error('Error occurred', error)

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('ERROR: Error occurred')
      expect(context).toMatchObject({
        error: 'Test error',
        stack: expect.any(String),
      })
    })

    it('should log error with both error object and additional context', () => {
      const error = new Error('Test error')
      const additionalContext = { operation: 'file-read', filePath: '/test/file.txt' }

      logger.error('File operation failed', error, additionalContext)

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
      logger.error('Error without exception')

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const [message, context] = consoleSpy.mock.calls[0]
      expect(message).toContain('ERROR: Error without exception')
      expect(context).toBeUndefined()
    })
  })

  describe('Constructor', () => {
    it('should use default info level when no level provided', () => {
      const defaultLogger = new Logger()
      const infoSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      defaultLogger.debug('Debug msg')
      defaultLogger.info('Info msg')

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('INFO: Info msg'))
      expect(infoSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG:'))

      infoSpy.mockRestore()
    })

    it('should accept custom level in constructor', () => {
      const debugLogger = new Logger('debug')
      const errorLogger = new Logger('error')
      const debugSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      debugLogger.debug('Debug from debug logger')
      errorLogger.debug('Debug from error logger')
      errorLogger.error('Error from error logger')

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG: Debug from debug logger')
      )
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('ERROR: Error from error logger')
      )
      expect(debugSpy).not.toHaveBeenCalledWith(expect.stringContaining('Debug from error logger'))

      debugSpy.mockRestore()
    })
  })
})
