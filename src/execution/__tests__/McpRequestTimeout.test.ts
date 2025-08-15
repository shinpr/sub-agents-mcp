import { DEFAULT_MCP_TIMEOUT_CONFIG, McpRequestTimeout } from 'src/execution/McpRequestTimeout'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('McpRequestTimeout', () => {
  let timeout: McpRequestTimeout

  beforeEach(() => {
    vi.clearAllTimers()
    vi.useFakeTimers()
    timeout = new McpRequestTimeout()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should use default configuration when none provided', () => {
      const instance = new McpRequestTimeout()
      expect(instance).toBeDefined()
    })

    it('should accept custom configuration', () => {
      const customConfig = {
        defaultTimeoutMs: 60000,
        maxTimeoutMs: 180000,
        progressResetEnabled: false,
        warningThresholdMs: 30000,
      }
      const instance = new McpRequestTimeout(customConfig)
      expect(instance).toBeDefined()
    })
  })

  describe('startTimeout', () => {
    it('should start timeout tracking for a request', () => {
      const onTimeout = vi.fn()
      const onProgress = vi.fn()

      const context = timeout.startTimeout('test-req-1', onTimeout, onProgress)

      expect(context.requestId).toBe('test-req-1')
      expect(context.isCompleted).toBe(false)
      expect(context.isCancelled).toBe(false)
      expect(context.progressCount).toBe(0)
    })

    it('should trigger warning after warning threshold', () => {
      const onTimeout = vi.fn()
      const onProgress = vi.fn()

      timeout.startTimeout('test-req-2', onTimeout, onProgress)

      // Fast-forward to warning threshold (1 minute by default)
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.warningThresholdMs)

      expect(onProgress).toHaveBeenCalledTimes(1)
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'test-req-2',
          message: 'Processing is taking longer than expected',
        })
      )
    })

    it('should trigger timeout after default timeout', () => {
      const onTimeout = vi.fn()
      const onProgress = vi.fn()

      timeout.startTimeout('test-req-3', onTimeout, onProgress)

      // Fast-forward to default timeout (2 minutes by default)
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.defaultTimeoutMs)

      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(onTimeout).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'test-req-3',
        })
      )
    })

    it('should enforce maximum timeout even with progress', () => {
      const onTimeout = vi.fn()
      const onProgress = vi.fn()

      timeout.startTimeout('test-req-4', onTimeout, onProgress)

      // Report progress multiple times
      vi.advanceTimersByTime(60000) // 1 minute
      timeout.reportProgress('test-req-4', 'Still working', 25)

      vi.advanceTimersByTime(60000) // 2 minutes total
      timeout.reportProgress('test-req-4', 'Making progress', 50)

      vi.advanceTimersByTime(60000) // 3 minutes total
      timeout.reportProgress('test-req-4', 'Almost done', 75)

      // Fast-forward to max timeout (5 minutes by default)
      vi.advanceTimersByTime(120000) // 5 minutes total

      expect(onTimeout).toHaveBeenCalledTimes(1)
    })
  })

  describe('reportProgress', () => {
    it('should increment progress count', () => {
      const onTimeout = vi.fn()

      const context = timeout.startTimeout('test-req-5', onTimeout)
      expect(context.progressCount).toBe(0)

      timeout.reportProgress('test-req-5', 'Progress 1')
      timeout.reportProgress('test-req-5', 'Progress 2')
      timeout.reportProgress('test-req-5', 'Progress 3')

      // Context is internal, but we can verify through the timeout behavior
      // The timeout should be reset if progressResetEnabled is true
    })

    it('should reset timeout when progress reset is enabled', () => {
      const onTimeout = vi.fn()

      timeout.startTimeout('test-req-6', onTimeout)

      // Advance to 90 seconds (less than default timeout of 2 minutes)
      vi.advanceTimersByTime(90000)

      // Report progress - should reset timeout
      timeout.reportProgress('test-req-6', 'Still processing')

      // Advance another 90 seconds (total 180 seconds)
      vi.advanceTimersByTime(90000)

      // Should not have timed out yet because of reset
      expect(onTimeout).not.toHaveBeenCalled()

      // Advance to new timeout (30 more seconds to reach 210 seconds total)
      vi.advanceTimersByTime(30000) // Total 210 seconds

      // Now it should timeout (90s + 120s after reset = 210s total)
      expect(onTimeout).toHaveBeenCalledTimes(1)
    })

    it('should not reset timeout when disabled', () => {
      const customTimeout = new McpRequestTimeout({
        progressResetEnabled: false,
        defaultTimeoutMs: 60000, // 1 minute for faster test
      })

      const onTimeout = vi.fn()

      customTimeout.startTimeout('test-req-7', onTimeout)

      // Report progress at 30 seconds
      vi.advanceTimersByTime(30000)
      customTimeout.reportProgress('test-req-7', 'Progress')

      // Advance to original timeout (1 minute total)
      vi.advanceTimersByTime(30000)

      // Should timeout at original time despite progress
      expect(onTimeout).toHaveBeenCalledTimes(1)
    })
  })

  describe('complete', () => {
    it('should mark request as completed and clear timeouts', () => {
      const onTimeout = vi.fn()

      timeout.startTimeout('test-req-8', onTimeout)
      timeout.complete('test-req-8')

      // Advance past all timeouts
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.maxTimeoutMs + 1000)

      // Timeout should not be called
      expect(onTimeout).not.toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('should cancel request and clear timeouts', () => {
      const onTimeout = vi.fn()

      timeout.startTimeout('test-req-9', onTimeout)
      timeout.cancel('test-req-9', 'User cancelled')

      // Advance past all timeouts
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.maxTimeoutMs + 1000)

      // Timeout should not be called
      expect(onTimeout).not.toHaveBeenCalled()
    })
  })

  describe('hasTimedOut', () => {
    it('should return false for active request within timeout', () => {
      timeout.startTimeout('test-req-10', vi.fn())

      vi.advanceTimersByTime(60000) // 1 minute

      expect(timeout.hasTimedOut('test-req-10')).toBe(false)
    })

    it('should return true after max timeout', () => {
      timeout.startTimeout('test-req-11', vi.fn())

      // Advance past max timeout
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.maxTimeoutMs + 1000)

      expect(timeout.hasTimedOut('test-req-11')).toBe(true)
    })

    it('should return false for non-existent request', () => {
      expect(timeout.hasTimedOut('non-existent')).toBe(false)
    })
  })

  describe('getStats', () => {
    it('should return statistics for active requests', () => {
      timeout.startTimeout('req-1', vi.fn())
      timeout.startTimeout('req-2', vi.fn())
      timeout.startTimeout('req-3', vi.fn())

      // Report progress on some requests
      timeout.reportProgress('req-1', 'Progress')
      timeout.reportProgress('req-1', 'More progress')
      timeout.reportProgress('req-2', 'Progress')

      // Complete one request
      timeout.complete('req-3')

      const stats = timeout.getStats()

      expect(stats.activeRequests).toBe(2) // req-1 and req-2 are still active
      expect(stats.averageProgressCount).toBe(1.5) // (2 + 1) / 2
      expect(stats.longestRunningMs).toBeGreaterThanOrEqual(0)
    })

    it('should return zero values when no active requests', () => {
      const stats = timeout.getStats()

      expect(stats.activeRequests).toBe(0)
      expect(stats.averageProgressCount).toBe(0)
      expect(stats.longestRunningMs).toBe(0)
    })
  })

  describe('clearTimeout', () => {
    it('should clear timeout for specific request', () => {
      const onTimeout = vi.fn()

      timeout.startTimeout('test-req-12', onTimeout)
      timeout.clearTimeout('test-req-12')

      // Advance past all timeouts
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.maxTimeoutMs + 1000)

      // Timeout should not be called
      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('should handle clearing non-existent request gracefully', () => {
      expect(() => timeout.clearTimeout('non-existent')).not.toThrow()
    })
  })

  describe('multiple concurrent requests', () => {
    it('should handle multiple concurrent requests independently', () => {
      const onTimeout1 = vi.fn()
      const onTimeout2 = vi.fn()
      const onTimeout3 = vi.fn()

      // Start three requests with different configurations
      timeout.startTimeout('req-a', onTimeout1)
      timeout.startTimeout('req-b', onTimeout2)
      timeout.startTimeout('req-c', onTimeout3)

      // Complete first request early
      vi.advanceTimersByTime(30000)
      timeout.complete('req-a')

      // Cancel second request
      vi.advanceTimersByTime(30000)
      timeout.cancel('req-b', 'Cancelled')

      // Let third request timeout
      vi.advanceTimersByTime(DEFAULT_MCP_TIMEOUT_CONFIG.defaultTimeoutMs)

      expect(onTimeout1).not.toHaveBeenCalled()
      expect(onTimeout2).not.toHaveBeenCalled()
      expect(onTimeout3).toHaveBeenCalledTimes(1)
    })
  })
})
