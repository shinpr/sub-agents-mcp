import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Logger, type LogLevel } from '../Logger.js'

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
    it.each<[string, LogLevel | undefined, string[], string[]]>([
      ['debug', 'debug', ['DEBUG', 'INFO', 'WARN', 'ERROR'], []],
      ['default (info)', undefined, ['INFO', 'WARN', 'ERROR'], ['DEBUG']],
      ['warn', 'warn', ['WARN', 'ERROR'], ['DEBUG', 'INFO']],
      ['error', 'error', ['ERROR'], ['DEBUG', 'INFO', 'WARN']],
    ])('should emit only levels at or above the %s level', (_label, level, emitted, suppressed) => {
      const levelLogger = new Logger(level)

      levelLogger.debug('Debug message')
      levelLogger.info('Info message')
      levelLogger.warn('Warning message')
      levelLogger.error('Error message')

      expect(consoleSpy).toHaveBeenCalledTimes(emitted.length)
      for (const name of emitted) {
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`${name}:`))
      }
      for (const name of suppressed) {
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining(`${name}:`))
      }
    })
  })

  describe('Structured Logging', () => {
    it('should log messages with timestamp and level', () => {
      logger.info('Test message')

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      const logCall = consoleSpy.mock.calls[0]?.[0]
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

    it.each([
      {
        label: 'an empty context',
        emit: (target: Logger) => target.info('Test message', {}),
        message: 'INFO: Test message',
      },
      {
        label: 'no context',
        emit: (target: Logger) => target.info('Simple message'),
        message: 'INFO: Simple message',
      },
      {
        label: 'an error call without an error object',
        emit: (target: Logger) => target.error('Error without exception'),
        message: 'ERROR: Error without exception',
      },
    ])('should log only the message for $label', ({ emit, message }) => {
      emit(logger)

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy.mock.calls[0]).toEqual([expect.stringContaining(message)])
    })
  })

  describe('Error Logging', () => {
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
  })
})
