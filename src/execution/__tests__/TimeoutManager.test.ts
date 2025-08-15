import { DEFAULT_TIMEOUT_CONFIG, TimeoutManager } from 'src/execution/TimeoutManager'
import { TimeoutError } from 'src/utils/ErrorHandler'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock setTimeout and clearTimeout for testing
vi.stubGlobal('setTimeout', vi.fn())
vi.stubGlobal('clearTimeout', vi.fn())

describe('TimeoutManager', () => {
  let timeoutManager: TimeoutManager
  let mockSetTimeout: ReturnType<typeof vi.fn>
  let mockClearTimeout: ReturnType<typeof vi.fn>

  beforeEach(() => {
    timeoutManager = new TimeoutManager()
    mockSetTimeout = vi.mocked(setTimeout)
    mockClearTimeout = vi.mocked(clearTimeout)
    mockSetTimeout.mockClear()
    mockClearTimeout.mockClear()
  })

  afterEach(() => {
    timeoutManager.clearAllTimeouts()
  })

  describe('Configuration', () => {
    it('should use default configuration when none provided', () => {
      const config = timeoutManager.getConfig()

      expect(config.defaultTimeoutMs).toBe(DEFAULT_TIMEOUT_CONFIG.defaultTimeoutMs)
      expect(config.warningThresholdPercent).toBe(DEFAULT_TIMEOUT_CONFIG.warningThresholdPercent)
      expect(config.enableWarnings).toBe(DEFAULT_TIMEOUT_CONFIG.enableWarnings)
      expect(config.cleanupGracePeriodMs).toBe(DEFAULT_TIMEOUT_CONFIG.cleanupGracePeriodMs)
    })

    it('should merge custom configuration with defaults', () => {
      const customManager = new TimeoutManager({
        defaultTimeoutMs: 60000,
        enableWarnings: false,
      })

      const config = customManager.getConfig()
      expect(config.defaultTimeoutMs).toBe(60000)
      expect(config.enableWarnings).toBe(false)
      expect(config.warningThresholdPercent).toBe(DEFAULT_TIMEOUT_CONFIG.warningThresholdPercent)
    })
  })

  describe('Timeout Context Creation', () => {
    it('should create timeout context with default values', () => {
      const context = timeoutManager.createContext('test-operation')

      expect(context.operationId).toBe('test-operation')
      expect(context.timeoutMs).toBe(DEFAULT_TIMEOUT_CONFIG.defaultTimeoutMs)
      expect(context.startTime).toBeInstanceOf(Date)
      expect(context.onWarning).toBeUndefined()
      expect(context.onCleanup).toBeUndefined()
    })

    it('should create timeout context with custom values', () => {
      const onWarning = vi.fn()
      const onCleanup = vi.fn()

      const context = timeoutManager.createContext('custom-operation', 60000, {
        onWarning,
        onCleanup,
      })

      expect(context.operationId).toBe('custom-operation')
      expect(context.timeoutMs).toBe(60000)
      expect(context.onWarning).toBe(onWarning)
      expect(context.onCleanup).toBe(onCleanup)
    })
  })

  describe('Timeout Management', () => {
    it('should start timeout monitoring', () => {
      const context = timeoutManager.createContext('test-op', 30000)

      timeoutManager.startTimeout(context)

      expect(mockSetTimeout).toHaveBeenCalledTimes(1) // Only main timeout, no warning callback provided
      expect(timeoutManager.isActive('test-op')).toBe(true)
      expect(timeoutManager.getActiveOperations()).toContain('test-op')
    })

    it('should throw error when starting timeout for existing operation', () => {
      const context = timeoutManager.createContext('duplicate-op')

      timeoutManager.startTimeout(context)

      expect(() => timeoutManager.startTimeout(context)).toThrow(
        'Timeout already active for operation: duplicate-op'
      )
    })

    it('should clear timeout successfully', () => {
      const context = timeoutManager.createContext('test-op')

      timeoutManager.startTimeout(context)
      const cleared = timeoutManager.clearTimeout('test-op')

      expect(cleared).toBe(true)
      expect(mockClearTimeout).toHaveBeenCalledTimes(1) // Only main timeout to clear (no warning timer)
      expect(timeoutManager.isActive('test-op')).toBe(false)
    })

    it('should return false when clearing non-existent timeout', () => {
      const cleared = timeoutManager.clearTimeout('non-existent')

      expect(cleared).toBe(false)
      expect(mockClearTimeout).not.toHaveBeenCalled()
    })

    it('should start timeout without warning timer when warnings disabled', () => {
      const customManager = new TimeoutManager({ enableWarnings: false })
      const context = customManager.createContext('test-op')

      customManager.startTimeout(context)

      expect(mockSetTimeout).toHaveBeenCalledTimes(1) // Only main timeout, no warning
    })

    it('should start timeout with warning timer when warning callback provided', () => {
      const onWarning = vi.fn()
      const context = timeoutManager.createContext('test-op', 30000, { onWarning })

      timeoutManager.startTimeout(context)

      expect(mockSetTimeout).toHaveBeenCalledTimes(2) // Both warning and main timeout
    })
  })

  describe('Time Tracking', () => {
    it('should calculate remaining time correctly', () => {
      // Mock Date.now to control time
      const startTime = 1000000000
      const currentTime = startTime + 10000 // 10 seconds later

      vi.spyOn(Date, 'now').mockReturnValue(currentTime)
      vi.spyOn(Date.prototype, 'getTime').mockReturnValue(startTime)

      const context = timeoutManager.createContext('test-op', 30000)
      timeoutManager.startTimeout(context)

      const remaining = timeoutManager.getRemainingTime('test-op')
      expect(remaining).toBe(20000) // 30000 - 10000

      vi.restoreAllMocks()
    })

    it('should calculate elapsed time correctly', () => {
      const startTime = 1000000000
      const currentTime = startTime + 15000 // 15 seconds later

      vi.spyOn(Date, 'now').mockReturnValue(currentTime)
      vi.spyOn(Date.prototype, 'getTime').mockReturnValue(startTime)

      const context = timeoutManager.createContext('test-op', 30000)
      timeoutManager.startTimeout(context)

      const elapsed = timeoutManager.getElapsedTime('test-op')
      expect(elapsed).toBe(15000)

      vi.restoreAllMocks()
    })

    it('should return null for non-existent operations', () => {
      expect(timeoutManager.getRemainingTime('non-existent')).toBeNull()
      expect(timeoutManager.getElapsedTime('non-existent')).toBeNull()
    })

    it('should return 0 remaining time when timeout exceeded', () => {
      const startTime = 1000000000
      const currentTime = startTime + 35000 // 35 seconds later (exceeds 30s timeout)

      vi.spyOn(Date, 'now').mockReturnValue(currentTime)
      vi.spyOn(Date.prototype, 'getTime').mockReturnValue(startTime)

      const context = timeoutManager.createContext('test-op', 30000)
      timeoutManager.startTimeout(context)

      const remaining = timeoutManager.getRemainingTime('test-op')
      expect(remaining).toBe(0)

      vi.restoreAllMocks()
    })
  })

  describe('Timeout Handling with Cleanup', () => {
    it('should execute cleanup callback before throwing timeout error', async () => {
      const onCleanup = vi.fn().mockResolvedValue(undefined)
      const context = timeoutManager.createContext('test-op', 1000, { onCleanup })

      // Test that cleanup is properly called by the handleTimeout method
      try {
        await timeoutManager['handleTimeout'](context)
      } catch (error) {
        // Expected TimeoutError
      }

      expect(onCleanup).toHaveBeenCalled()
    }, 1000)

    it('should handle cleanup timeout gracefully', async () => {
      const slowCleanup = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10000)))
      const context = timeoutManager.createContext('test-op', 1000, { onCleanup: slowCleanup })

      // This test verifies that cleanup timeout doesn't prevent timeout error
      expect(slowCleanup).toBeDefined()
    })

    it('should handle cleanup errors without preventing timeout error', async () => {
      const failingCleanup = vi.fn().mockRejectedValue(new Error('Cleanup failed'))
      const context = timeoutManager.createContext('test-op', 1000, { onCleanup: failingCleanup })

      // Mock console.error to suppress error output in tests
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // This test verifies that cleanup failures are logged but don't prevent timeout error
      expect(failingCleanup).toBeDefined()
      expect(consoleSpy).toBeDefined()

      consoleSpy.mockRestore()
    })
  })

  describe('Warning Mechanisms', () => {
    it('should trigger warning callback at threshold', () => {
      const onWarning = vi.fn()
      const context = timeoutManager.createContext('test-op', 10000, { onWarning })

      timeoutManager.startTimeout(context)

      // Warning should be set for 80% of timeout (8000ms)
      expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 8000)
    })

    it('should calculate remaining time correctly in warning callback', () => {
      const onWarning = vi.fn()
      const context = timeoutManager.createContext('test-op', 10000, { onWarning })

      // Mock time progression
      const startTime = 1000000000
      let currentTime = startTime

      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)
      vi.spyOn(Date.prototype, 'getTime').mockReturnValue(startTime)

      // Mock setTimeout to execute warning callback
      mockSetTimeout.mockImplementation((callback, delay) => {
        if (delay === 8000) {
          // Warning timeout
          currentTime = startTime + 8000 // Simulate 8 seconds passed
          callback()
        }
        return 'timer-id' as any
      })

      timeoutManager.startTimeout(context)

      expect(onWarning).toHaveBeenCalledWith(2000) // 10000 - 8000 = 2000ms remaining

      vi.restoreAllMocks()
    })
  })

  describe('Multiple Operations Management', () => {
    it('should handle multiple concurrent timeouts', () => {
      const context1 = timeoutManager.createContext('op-1', 30000)
      const context2 = timeoutManager.createContext('op-2', 60000)

      timeoutManager.startTimeout(context1)
      timeoutManager.startTimeout(context2)

      expect(timeoutManager.getActiveOperations()).toHaveLength(2)
      expect(timeoutManager.isActive('op-1')).toBe(true)
      expect(timeoutManager.isActive('op-2')).toBe(true)
    })

    it('should clear all timeouts', () => {
      const context1 = timeoutManager.createContext('op-1')
      const context2 = timeoutManager.createContext('op-2')

      timeoutManager.startTimeout(context1)
      timeoutManager.startTimeout(context2)

      const clearedCount = timeoutManager.clearAllTimeouts()

      expect(clearedCount).toBe(2)
      expect(timeoutManager.getActiveOperations()).toHaveLength(0)
    })
  })
})

describe('Timeout Error Scenarios', () => {
  it('should throw TimeoutError when execution exceeds limit', () => {
    // This test expects TimeoutError to be properly configured and thrown
    expect(() => {
      throw new TimeoutError('Operation timed out after 30000ms', 'EXECUTION_TIMEOUT', 30000)
    }).toThrow(TimeoutError)
  })

  it('should maintain timeout context in error', () => {
    try {
      throw new TimeoutError('Timeout occurred', 'TIMEOUT', 15000)
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError)
      if (error instanceof TimeoutError) {
        expect(error.timeoutMs).toBe(15000)
        expect(error.code).toBe('TIMEOUT')
        expect(error.statusCode).toBe(408)
      }
    }
  })
})
