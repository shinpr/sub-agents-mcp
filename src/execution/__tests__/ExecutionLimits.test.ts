import { DEFAULT_EXECUTION_LIMITS, ExecutionLimits } from 'src/execution/ExecutionLimits'
import { ResourceLimitError } from 'src/utils/ErrorHandler'
import { beforeEach, describe, expect, it } from 'vitest'

describe('ExecutionLimits', () => {
  let executionLimits: ExecutionLimits

  beforeEach(() => {
    executionLimits = new ExecutionLimits()
  })

  describe('Configuration', () => {
    it('should use default configuration when none provided', () => {
      const config = executionLimits.getConfig()

      expect(config.maxConcurrentExecutions).toBe(DEFAULT_EXECUTION_LIMITS.maxConcurrentExecutions)
      expect(config.maxMemoryUsageMB).toBe(DEFAULT_EXECUTION_LIMITS.maxMemoryUsageMB)
      expect(config.maxOutputSizeBytes).toBe(DEFAULT_EXECUTION_LIMITS.maxOutputSizeBytes)
      expect(config.maxExecutionTimeMs).toBe(DEFAULT_EXECUTION_LIMITS.maxExecutionTimeMs)
      expect(config.enableResourceMonitoring).toBe(
        DEFAULT_EXECUTION_LIMITS.enableResourceMonitoring
      )
    })

    it('should merge custom configuration with defaults', () => {
      const customLimits = new ExecutionLimits({
        maxConcurrentExecutions: 10,
        maxMemoryUsageMB: 200,
      })

      const config = customLimits.getConfig()
      expect(config.maxConcurrentExecutions).toBe(10)
      expect(config.maxMemoryUsageMB).toBe(200)
      expect(config.maxOutputSizeBytes).toBe(DEFAULT_EXECUTION_LIMITS.maxOutputSizeBytes)
    })
  })

  describe('Concurrency Limit Enforcement', () => {
    it('should allow registering executions within limit', () => {
      expect(() => executionLimits.registerExecution('exec-1')).not.toThrow()
      expect(() => executionLimits.registerExecution('exec-2')).not.toThrow()

      expect(executionLimits.getActiveExecutionCount()).toBe(2)
    })

    it('should throw ResourceLimitError when concurrency limit exceeded', () => {
      // Fill up to the limit (default is 5)
      for (let i = 1; i <= 5; i++) {
        executionLimits.registerExecution(`exec-${i}`)
      }

      // This should throw an error
      expect(() => executionLimits.registerExecution('exec-6')).toThrow(ResourceLimitError)
      expect(() => executionLimits.registerExecution('exec-6')).toThrow(
        'Maximum concurrent executions exceeded: 5'
      )
    })

    it('should properly unregister executions', () => {
      executionLimits.registerExecution('exec-1')
      executionLimits.registerExecution('exec-2')

      expect(executionLimits.getActiveExecutionCount()).toBe(2)

      executionLimits.unregisterExecution('exec-1')
      expect(executionLimits.getActiveExecutionCount()).toBe(1)

      // Should be able to register new execution after unregistering
      expect(() => executionLimits.registerExecution('exec-3')).not.toThrow()
    })

    it('should handle unregistering non-existent execution gracefully', () => {
      expect(() => executionLimits.unregisterExecution('non-existent')).not.toThrow()
      expect(executionLimits.getActiveExecutionCount()).toBe(0)
    })
  })

  describe('Memory Limit Enforcement', () => {
    it('should allow memory usage within limit', () => {
      expect(() => executionLimits.checkMemoryLimit(50)).not.toThrow()
      expect(() => executionLimits.checkMemoryLimit(100)).not.toThrow()
    })

    it('should throw ResourceLimitError when memory limit exceeded', () => {
      expect(() => executionLimits.checkMemoryLimit(101)).toThrow(ResourceLimitError)
      expect(() => executionLimits.checkMemoryLimit(101)).toThrow(
        'Memory usage exceeded: 101MB > 100MB'
      )

      try {
        executionLimits.checkMemoryLimit(150)
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceLimitError)
        if (error instanceof ResourceLimitError) {
          expect(error.resourceType).toBe('memory')
          expect(error.limitValue).toBe(100)
          expect(error.code).toBe('MEMORY_LIMIT_EXCEEDED')
        }
      }
    })
  })

  describe('Output Size Limit Enforcement', () => {
    it('should allow output size within limit', () => {
      expect(() => executionLimits.checkOutputSizeLimit(1024 * 512)).not.toThrow() // 0.5MB
      expect(() => executionLimits.checkOutputSizeLimit(1024 * 1024)).not.toThrow() // 1MB
    })

    it('should throw ResourceLimitError when output size limit exceeded', () => {
      const oversizeBytes = 1024 * 1024 + 1 // 1MB + 1 byte

      expect(() => executionLimits.checkOutputSizeLimit(oversizeBytes)).toThrow(ResourceLimitError)
      expect(() => executionLimits.checkOutputSizeLimit(oversizeBytes)).toThrow(
        'Output size exceeded'
      )

      try {
        executionLimits.checkOutputSizeLimit(oversizeBytes)
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceLimitError)
        if (error instanceof ResourceLimitError) {
          expect(error.resourceType).toBe('output_size')
          expect(error.limitValue).toBe(1024 * 1024)
          expect(error.code).toBe('OUTPUT_SIZE_LIMIT_EXCEEDED')
        }
      }
    })
  })

  describe('Resource Usage Statistics', () => {
    it('should return current resource usage', () => {
      executionLimits.registerExecution('exec-1')
      executionLimits.registerExecution('exec-2')

      const usage = executionLimits.getResourceUsage(50, 1024, 5000)

      expect(usage.memoryUsageMB).toBe(50)
      expect(usage.activeExecutions).toBe(2)
      expect(usage.outputSizeBytes).toBe(1024)
      expect(usage.executionTimeMs).toBe(5000)
    })

    it('should return default values when no parameters provided', () => {
      const usage = executionLimits.getResourceUsage()

      expect(usage.memoryUsageMB).toBe(0)
      expect(usage.activeExecutions).toBe(0)
      expect(usage.outputSizeBytes).toBe(0)
      expect(usage.executionTimeMs).toBe(0)
    })
  })

  describe('Resource Monitoring', () => {
    it('should indicate resource monitoring status', () => {
      expect(executionLimits.isResourceMonitoringEnabled()).toBe(true)

      const disabledMonitoring = new ExecutionLimits({ enableResourceMonitoring: false })
      expect(disabledMonitoring.isResourceMonitoringEnabled()).toBe(false)
    })
  })
})

describe('Graceful Degradation Scenarios', () => {
  it('should handle partial functionality when non-critical errors occur', () => {
    const executionLimits = new ExecutionLimits()

    // Test that system continues to function even when some limits are reached
    executionLimits.registerExecution('exec-1')

    // Memory check should still work independently
    expect(() => executionLimits.checkMemoryLimit(50)).not.toThrow()

    // Output size check should still work independently
    expect(() => executionLimits.checkOutputSizeLimit(1024)).not.toThrow()

    expect(executionLimits.getActiveExecutionCount()).toBe(1)
  })

  it('should isolate component failures', () => {
    const executionLimits = new ExecutionLimits()

    // One type of limit failure should not affect others
    try {
      executionLimits.checkMemoryLimit(200) // This will fail
    } catch (error) {
      // Memory limit failure should not affect concurrency limits
      expect(() => executionLimits.registerExecution('exec-1')).not.toThrow()
      expect(executionLimits.getActiveExecutionCount()).toBe(1)
    }
  })
})
