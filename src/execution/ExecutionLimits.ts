/**
 * Execution limits configuration and enforcement for agent execution.
 *
 * Provides configurable limits for resource usage including memory, concurrency,
 * execution time, and output size to ensure system stability and prevent abuse.
 */

import { ResourceLimitError } from 'src/utils/ErrorHandler'

/**
 * Configuration interface for execution limits.
 */
export interface ExecutionLimitsConfig {
  /** Maximum number of concurrent agent executions (default: 5) */
  maxConcurrentExecutions: number

  /** Maximum memory usage per execution in MB (default: 100) */
  maxMemoryUsageMB: number

  /** Maximum output size in bytes (default: 1MB) */
  maxOutputSizeBytes: number

  /** Maximum execution time in milliseconds (default: 90000) */
  maxExecutionTimeMs: number

  /** Enable resource monitoring (default: true) */
  enableResourceMonitoring: boolean
}

/**
 * Resource usage statistics for monitoring.
 */
export interface ResourceUsage {
  /** Current memory usage in MB */
  memoryUsageMB: number

  /** Current number of active executions */
  activeExecutions: number

  /** Current output size in bytes */
  outputSizeBytes: number

  /** Execution time elapsed in milliseconds */
  executionTimeMs: number
}

/**
 * Default execution limits configuration.
 */
export const DEFAULT_EXECUTION_LIMITS: ExecutionLimitsConfig = {
  maxConcurrentExecutions: 5,
  maxMemoryUsageMB: 100,
  maxOutputSizeBytes: 1024 * 1024, // 1MB
  maxExecutionTimeMs: 90000, // 90 seconds
  enableResourceMonitoring: true,
}

/**
 * Execution limits enforcer for resource constraint management.
 *
 * Monitors and enforces limits on concurrent executions, memory usage,
 * output size, and execution time to prevent resource exhaustion.
 */
export class ExecutionLimits {
  private readonly config: ExecutionLimitsConfig
  private activeExecutions: Set<string> = new Set()

  /**
   * Creates a new ExecutionLimits instance.
   *
   * @param config - Execution limits configuration (uses defaults if not provided)
   */
  constructor(config: Partial<ExecutionLimitsConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTION_LIMITS, ...config }
  }

  /**
   * Checks if a new execution can be started within limits.
   *
   * @param executionId - Unique identifier for the execution
   * @throws {ResourceLimitError} When concurrent execution limit is exceeded
   */
  checkConcurrencyLimit(executionId: string): void {
    if (this.activeExecutions.size >= this.config.maxConcurrentExecutions) {
      throw new ResourceLimitError(
        `Maximum concurrent executions exceeded: ${this.config.maxConcurrentExecutions}`,
        'CONCURRENCY_LIMIT_EXCEEDED',
        'concurrency',
        this.config.maxConcurrentExecutions,
        {
          operation: 'concurrency_check',
          metadata: { executionId, currentCount: this.activeExecutions.size },
        }
      )
    }
  }

  /**
   * Registers a new execution as active.
   *
   * @param executionId - Unique identifier for the execution
   */
  registerExecution(executionId: string): void {
    this.checkConcurrencyLimit(executionId)
    this.activeExecutions.add(executionId)
  }

  /**
   * Unregisters an execution as completed.
   *
   * @param executionId - Unique identifier for the execution
   */
  unregisterExecution(executionId: string): void {
    this.activeExecutions.delete(executionId)
  }

  /**
   * Checks if memory usage is within limits.
   *
   * @param memoryUsageMB - Current memory usage in MB
   * @throws {ResourceLimitError} When memory limit is exceeded
   */
  checkMemoryLimit(memoryUsageMB: number): void {
    if (memoryUsageMB > this.config.maxMemoryUsageMB) {
      throw new ResourceLimitError(
        `Memory usage exceeded: ${memoryUsageMB}MB > ${this.config.maxMemoryUsageMB}MB`,
        'MEMORY_LIMIT_EXCEEDED',
        'memory',
        this.config.maxMemoryUsageMB
      )
    }
  }

  /**
   * Checks if output size is within limits.
   *
   * @param outputSizeBytes - Current output size in bytes
   * @throws {ResourceLimitError} When output size limit is exceeded
   */
  checkOutputSizeLimit(outputSizeBytes: number): void {
    if (outputSizeBytes > this.config.maxOutputSizeBytes) {
      throw new ResourceLimitError(
        `Output size exceeded: ${outputSizeBytes} bytes > ${this.config.maxOutputSizeBytes} bytes`,
        'OUTPUT_SIZE_LIMIT_EXCEEDED',
        'output_size',
        this.config.maxOutputSizeBytes
      )
    }
  }

  /**
   * Gets current resource usage statistics.
   *
   * @param currentMemoryMB - Current memory usage in MB
   * @param currentOutputBytes - Current output size in bytes
   * @param executionTimeMs - Current execution time in milliseconds
   * @returns Resource usage statistics
   */
  getResourceUsage(
    currentMemoryMB = 0,
    currentOutputBytes = 0,
    executionTimeMs = 0
  ): ResourceUsage {
    return {
      memoryUsageMB: currentMemoryMB,
      activeExecutions: this.activeExecutions.size,
      outputSizeBytes: currentOutputBytes,
      executionTimeMs,
    }
  }

  /**
   * Gets the current configuration.
   *
   * @returns Execution limits configuration
   */
  getConfig(): ExecutionLimitsConfig {
    return { ...this.config }
  }

  /**
   * Gets the number of active executions.
   *
   * @returns Number of active executions
   */
  getActiveExecutionCount(): number {
    return this.activeExecutions.size
  }

  /**
   * Checks if resource monitoring is enabled.
   *
   * @returns True if resource monitoring is enabled
   */
  isResourceMonitoringEnabled(): boolean {
    return this.config.enableResourceMonitoring
  }

  /**
   * Gets adaptive resource limits based on current system state.
   *
   * @param systemMemoryMB - Current available system memory in MB
   * @param systemLoad - Current system load (0-1)
   * @returns Adjusted execution limits configuration
   */
  getAdaptiveLimits(systemMemoryMB: number, systemLoad = 0.5): ExecutionLimitsConfig {
    const baseLimits = this.getConfig()

    // Adjust limits based on available system resources
    const memoryMultiplier = Math.min(systemMemoryMB / 1000, 2) // Scale up to 2x for high memory systems
    const loadMultiplier = Math.max(1 - systemLoad, 0.3) // Reduce limits under high load

    return {
      ...baseLimits,
      maxConcurrentExecutions: Math.max(
        Math.floor(baseLimits.maxConcurrentExecutions * loadMultiplier),
        1
      ),
      maxMemoryUsageMB: Math.floor(baseLimits.maxMemoryUsageMB * memoryMultiplier),
      maxExecutionTimeMs:
        systemLoad > 0.8
          ? Math.floor(baseLimits.maxExecutionTimeMs * 1.5) // More time under high load
          : baseLimits.maxExecutionTimeMs,
    }
  }

  /**
   * Monitors resource usage and suggests optimizations.
   *
   * @param currentUsage - Current resource usage
   * @returns Resource optimization suggestions
   */
  analyzeResourceUsage(currentUsage: ResourceUsage): {
    recommendations: string[]
    severity: 'low' | 'medium' | 'high'
    shouldThrottle: boolean
  } {
    const config = this.getConfig()
    const recommendations: string[] = []
    let severity: 'low' | 'medium' | 'high' = 'low'
    let shouldThrottle = false

    // Analyze concurrency
    const concurrencyUtilization = currentUsage.activeExecutions / config.maxConcurrentExecutions
    if (concurrencyUtilization > 0.8) {
      recommendations.push('High concurrency utilization detected - consider queuing new requests')
      severity = 'medium'
      shouldThrottle = true
    }

    // Analyze memory usage
    const memoryUtilization = currentUsage.memoryUsageMB / config.maxMemoryUsageMB
    if (memoryUtilization > 0.9) {
      recommendations.push(
        'Memory usage approaching limit - consider reducing concurrent executions'
      )
      severity = 'high'
      shouldThrottle = true
    } else if (memoryUtilization > 0.7) {
      recommendations.push('Memory usage elevated - monitor closely')
      if (severity === 'low') severity = 'medium'
    }

    // Analyze output size trends
    const outputUtilization = currentUsage.outputSizeBytes / config.maxOutputSizeBytes
    if (outputUtilization > 0.8) {
      recommendations.push(
        'Output size approaching limit - consider using spawn method for large outputs'
      )
      if (severity === 'low') severity = 'medium'
    }

    // Analyze execution time
    if (currentUsage.executionTimeMs > config.maxExecutionTimeMs * 0.8) {
      recommendations.push(
        'Execution time approaching timeout - consider optimizing agent performance'
      )
      if (severity === 'low') severity = 'medium'
    }

    return {
      recommendations,
      severity,
      shouldThrottle,
    }
  }

  /**
   * Creates execution limits optimized for specific operation types.
   *
   * @param operationType - Type of operation (light, standard, heavy)
   * @returns Optimized execution limits configuration
   */
  createOptimizedConfig(operationType: 'light' | 'standard' | 'heavy'): ExecutionLimitsConfig {
    const baseLimits = DEFAULT_EXECUTION_LIMITS

    switch (operationType) {
      case 'light':
        return {
          ...baseLimits,
          maxConcurrentExecutions: baseLimits.maxConcurrentExecutions * 2,
          maxMemoryUsageMB: baseLimits.maxMemoryUsageMB * 0.5,
          maxExecutionTimeMs: baseLimits.maxExecutionTimeMs * 0.5,
          maxOutputSizeBytes: baseLimits.maxOutputSizeBytes * 0.5,
        }

      case 'heavy':
        return {
          ...baseLimits,
          maxConcurrentExecutions: Math.max(baseLimits.maxConcurrentExecutions * 0.5, 1),
          maxMemoryUsageMB: baseLimits.maxMemoryUsageMB * 2,
          maxExecutionTimeMs: baseLimits.maxExecutionTimeMs * 2,
          maxOutputSizeBytes: baseLimits.maxOutputSizeBytes * 2,
        }

      default: // standard
        return baseLimits
    }
  }
}
