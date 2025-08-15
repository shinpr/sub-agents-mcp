import { type ChildProcess, spawn } from 'node:child_process'
import type { ExecutionParams } from 'src/types/ExecutionParams'
import { type LogLevel, Logger } from 'src/utils/Logger'

// Type definition for global object with garbage collection
interface GlobalWithGC {
  gc?: () => void
  vi?: unknown
}

declare const global: GlobalWithGC

/**
 * Detailed execution result that includes performance metrics and method information.
 * Extends the basic ExecutionResult with additional monitoring capabilities.
 */
export interface AgentExecutionResult {
  /**
   * Standard output from the agent execution.
   * Contains the agent's response or execution result.
   */
  stdout: string

  /**
   * Standard error output from the agent execution.
   * Contains error messages and diagnostic information.
   */
  stderr: string

  /**
   * Exit code returned by the agent process.
   * 0 indicates success, non-zero indicates failure.
   */
  exitCode: number

  /**
   * Total execution time in milliseconds.
   * Used for performance monitoring and optimization.
   */
  executionTime: number

  /**
   * The execution method used (always spawn for Claude Code CLI).
   */
  executionMethod: 'spawn'

  /**
   * Estimated output size that determined the execution method.
   * Used for method selection analysis and optimization.
   */
  estimatedOutputSize: number
}

/**
 * Configuration for execution thresholds.
 * Contains settings for output size and timeout handling.
 */
export interface ExecutionConfig {
  /**
   * Output size threshold in bytes for performance monitoring.
   * Default: 1MB (1024 * 1024 bytes)
   */
  outputSizeThreshold: number

  /**
   * Maximum execution timeout in milliseconds.
   * Default: 30 seconds (30000ms)
   */
  executionTimeout: number

  /**
   * CLI command used to execute agents.
   * In production: 'cursor-agent' or 'codex'
   * In tests: 'echo' for mocking
   */
  cliCommand: string
}

/**
 * Default thresholds for agent execution.
 */
export const DEFAULT_EXECUTION_THRESHOLDS = {
  outputSizeThreshold: 1024 * 1024, // 1MB
  executionTimeout: 30000, // 30 seconds
}

/**
 * Creates a complete ExecutionConfig with the provided CLI command.
 * @param cliCommand - The CLI command to execute agents with
 * @param overrides - Optional overrides for thresholds
 */
export function createExecutionConfig(
  cliCommand: string,
  overrides?: Partial<Omit<ExecutionConfig, 'cliCommand'>>
): ExecutionConfig {
  return {
    ...DEFAULT_EXECUTION_THRESHOLDS,
    ...overrides,
    cliCommand,
  }
}

/**
 * AgentExecutor class implements execution strategy for running Claude Code agents.
 * Uses child_process.spawn for proper TTY handling and stdin/stdout streaming.
 * Includes performance monitoring and timeout management.
 */
export class AgentExecutor {
  private readonly config: ExecutionConfig
  private readonly logger: Logger

  /**
   * Creates a new AgentExecutor instance.
   *
   * @param config - Execution configuration including CLI command and thresholds
   * @param logger - Optional Logger instance for structured logging
   */
  constructor(config: ExecutionConfig, logger?: Logger) {
    this.config = config
    // Use provided logger or create new one with LOG_LEVEL env var
    this.logger = logger || new Logger((process.env['LOG_LEVEL'] as LogLevel) || 'info')
  }

  /**
   * Executes an agent with the specified parameters using spawn strategy.
   *
   * This method implements the core execution logic using spawn for proper TTY
   * handling and streaming. It includes comprehensive performance monitoring.
   *
   * @param params - Execution parameters including agent name, prompt, and options
   * @returns Promise resolving to detailed execution result with performance metrics
   * @throws {Error} When agent execution fails or parameters are invalid
   *
   * @example
   * ```typescript
   * const executor = new AgentExecutor()
   * const result = await executor.executeAgent({
   *   agent: "code-helper",
   *   prompt: "Review this code",
   *   cwd: "/project"
   * })
   * console.log(`Execution took ${result.executionTime}ms using ${result.executionMethod}`)
   * ```
   */
  async executeAgent(params: ExecutionParams): Promise<AgentExecutionResult> {
    // Input validation
    if (!params || !params.agent || !params.prompt) {
      const error = 'Invalid execution parameters: agent and prompt are required'
      this.logger.error('Agent execution failed during validation', undefined, { error, params })
      throw new Error(error)
    }

    if (params.agent.length === 0 || params.prompt.length === 0) {
      const error = 'Invalid execution parameters: agent and prompt cannot be empty'
      this.logger.error('Agent execution failed during validation', undefined, { error, params })
      throw new Error(error)
    }

    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Starting agent execution', {
      requestId,
      agent: params.agent,
      promptLength: params.prompt.length,
      cwd: params.cwd,
      extraArgs: params.extra_args?.length || 0,
    })

    try {
      // Add minimal delay to ensure execution time is measurable
      await new Promise((resolve) => setTimeout(resolve, 1))

      // Use spawn method for proper TTY handling
      const adaptiveConfig = this.getAdaptiveConfig()
      const executionMethod = 'spawn' as const
      const estimatedOutputSize = this.estimateOutputSize(params)

      this.logger.info('Execution method selected', {
        requestId,
        executionMethod,
        estimatedOutputSize,
        threshold: adaptiveConfig.outputSizeThreshold,
      })

      // Monitor memory usage before execution
      this.monitorMemoryUsage(`before_execution_${executionMethod}`)

      // Execute using spawn for proper TTY handling
      const result = await this.executeWithSpawn(params)

      const executionTime = Date.now() - startTime

      // Monitor memory usage after execution
      this.monitorMemoryUsage(`after_execution_${executionMethod}`)

      // Log detailed execution results including stderr content for debugging
      if (result.stderr && result.stderr.length > 0) {
        this.logger.warn('Agent execution completed with stderr output', {
          requestId,
          executionMethod,
          exitCode: result.exitCode,
          executionTime,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          stderrContent: result.stderr.substring(0, 1000), // First 1000 chars of stderr
        })
      } else {
        this.logger.info('Agent execution completed', {
          requestId,
          executionMethod,
          exitCode: result.exitCode,
          executionTime,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
        })
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime,
        executionMethod,
        estimatedOutputSize,
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const executionMethod = this.selectExecutionMethod(params)
      const estimatedOutputSize = this.estimateOutputSize(params)

      this.logger.error('Agent execution failed', error instanceof Error ? error : undefined, {
        requestId,
        executionTime,
        executionMethod,
      })

      // Re-throw enhancement errors
      if (
        error instanceof Error &&
        (error.message.includes('enhance') || error.message.includes('Enhancement'))
      ) {
        throw error
      }

      // Return error result for execution failures
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown execution error',
        exitCode: 1,
        executionTime,
        executionMethod,
        estimatedOutputSize,
      }
    }
  }

  /**
   * Returns the execution method (always 'spawn' for proper TTY handling).
   *
   * Claude Code CLI requires proper TTY and stdin/stdout handling,
   * so this method always returns 'spawn'.
   *
   * @param params - Execution parameters (unused)
   * @returns Always returns 'spawn'
   */
  selectExecutionMethod(params: ExecutionParams): 'spawn' {
    // params is intentionally unused but kept for interface consistency
    void params
    return 'spawn'
  }

  /**
   * Estimates the expected output size for the given execution parameters.
   *
   * This is a heuristic method that analyzes the prompt content and agent type
   * to predict whether the output will exceed the configured threshold. Used
   * internally by selectExecutionMethod for decision making.
   *
   * @private
   * @param params - Execution parameters to analyze
   * @returns Estimated output size in bytes
   */
  private estimateOutputSize(params: ExecutionParams): number {
    // Simple heuristic: assume output is roughly based on prompt characteristics
    // plus some base overhead for detailed responses
    const baseSize = 1024 // 1KB base size
    const promptMultiplier = 100
    const promptSize = params.prompt.length * promptMultiplier

    // Add extra estimation for certain agent types that tend to produce more output
    let sizeMultiplier = 1
    if (
      params.agent.includes('detailed') ||
      params.agent.includes('thorough') ||
      params.agent.includes('analyzer')
    ) {
      sizeMultiplier = 50
    }

    // For very long prompts (>1000 chars), assume large output
    if (params.prompt.length > 1000) {
      sizeMultiplier = Math.max(sizeMultiplier, 200)
    }

    return (baseSize + promptSize) * sizeMultiplier
  }

  /**
   * Executes an agent using child_process.spawn for proper TTY handling.
   *
   * @private
   * @param params - Execution parameters
   * @returns Promise resolving to execution result
   */
  private async executeWithSpawn(
    params: ExecutionParams
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      // Parse command to separate binary and arguments from cliCommand
      const commandParts = this.config.cliCommand.trim().split(/\s+/)
      const command = commandParts[0]!
      const commandArgs = commandParts.slice(1)

      // Resolve the actual executable path
      // If command contains '/', use it as-is (absolute path)
      // Otherwise, let the system find it in PATH
      const cliPath = command

      // Build arguments array with improved prompt format
      // Format: [System Context] agent definition content
      //         [User Prompt] actual user request
      const formattedPrompt = `[System Context]\n${params.agent}\n\n[User Prompt]\n${params.prompt}`
      const args = [...commandArgs]

      // Only add prompt if -p flag is present (it should be for non-interactive mode)
      if (commandArgs.includes('-p')) {
        // -p flag is already in commandArgs, just add the formatted prompt
        args.push(formattedPrompt)
      } else {
        // Add both -p flag and prompt (shouldn't happen with current setup)
        args.push('-p', formattedPrompt)
      }

      // Add API key for cursor-cli using -a option
      if (process.env['CLI_API_KEY'] && command.includes('cursor')) {
        args.push('-a', process.env['CLI_API_KEY'])
      }

      // Log execution details at debug level
      this.logger.debug('Executing with spawn (direct, no shell)', {
        cliPath,
        args,
        cwd: params.cwd || process.cwd(),
        env: 'inheriting process.env',
      })

      // Use spawn WITHOUT shell for direct execution
      const childProcess: ChildProcess = spawn(cliPath, args, {
        cwd: params.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false, // Direct execution, no shell interpretation
        env: process.env, // Explicitly inherit all environment variables
      })

      let stdout = ''
      let stderr = ''
      let stdoutBuffer = ''
      let assistantResponse: string | null = null
      let idleTimer: NodeJS.Timeout | null = null
      let assistantStarted = false
      const IDLE_TIMEOUT = 3000 // 3 seconds of no data AFTER assistant starts responding

      // Close stdin immediately as we're not sending any input
      childProcess.stdin?.end()

      // Function to handle idle timeout
      const resetIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
        }

        // Only start idle timer AFTER assistant starts responding
        if (assistantStarted) {
          idleTimer = setTimeout(() => {
            this.logger.debug('Idle timeout reached, terminating process', {
              stdoutLength: stdout.length,
              assistantResponseLength: assistantResponse?.length || 0,
            })
            childProcess.kill('SIGTERM')
          }, IDLE_TIMEOUT)
        }
      }

      // Parse JSON lines from cursor-agent output
      const parseJsonLine = (line: string) => {
        try {
          const json = JSON.parse(line)
          // Log JSON parsing at trace level (would need to add trace level support)
          // For now, skip detailed JSON parsing logs to reduce noise

          // Look for assistant's response
          if (json.type === 'assistant' && json.message) {
            // Mark that assistant has started responding
            if (!assistantStarted) {
              assistantStarted = true
              // Mark assistant response start silently
            }

            // Extract the actual response content
            if (json.message.content && Array.isArray(json.message.content)) {
              const textContent = json.message.content
                .filter((c: unknown) => {
                  const content = c as { type?: string; text?: string }
                  return content.type === 'text'
                })
                .map((c: unknown) => {
                  const content = c as { text?: string }
                  return content.text || ''
                })
                .join('\n')

              if (textContent) {
                // Accumulate response instead of overwriting
                if (assistantResponse === null) {
                  assistantResponse = textContent
                } else {
                  assistantResponse += textContent
                }
                // Track response accumulation silently
                // Only log issues or final results
              }
            }
          }
        } catch (e) {
          // Not all lines are JSON, ignore parse errors
        }
      }

      // Handle stdout stream
      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk
        stdoutBuffer += chunk

        // Reset idle timer if assistant has started responding
        resetIdleTimer()

        // Process complete lines
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            parseJsonLine(line)
          }
        }
      })

      // Handle stderr stream
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      // Handle process completion
      childProcess.on('close', (code: number | null) => {
        // Clear timers
        if (idleTimer) {
          clearTimeout(idleTimer)
        }

        // If we have an assistant response, return it as the main output
        const finalOutput = assistantResponse || stdout
        resolve({
          stdout: finalOutput,
          stderr,
          exitCode: code || 0,
        })
      })

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        // Clear timers
        if (idleTimer) {
          clearTimeout(idleTimer)
        }

        resolve({
          stdout: assistantResponse || stdout,
          stderr: stderr || error.message,
          exitCode: 1,
        })
      })

      // Set overall execution timeout from config
      const executionTimeout = setTimeout(() => {
        if (idleTimer) {
          clearTimeout(idleTimer)
        }
        this.logger.warn('Overall execution timeout reached', {
          assistantStarted,
          assistantResponseLength: assistantResponse?.length || 0,
        })
        childProcess.kill('SIGTERM')
        resolve({
          stdout: assistantResponse || stdout,
          stderr: stderr || 'Execution timeout exceeded',
          exitCode: 124,
        })
      }, this.config.executionTimeout)

      // Clear execution timeout on close
      childProcess.on('exit', () => {
        clearTimeout(executionTimeout)
      })
    })
  }

  /**
   * Generates a unique request ID for tracking execution requests.
   *
   * @private
   * @returns Unique request identifier
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Monitors memory usage and triggers garbage collection if needed.
   * Implements memory management strategy for large output scenarios.
   *
   * @private
   * @param context - Context information for logging
   */
  private monitorMemoryUsage(context: string): void {
    if (process.memoryUsage && typeof global !== 'undefined' && typeof global.gc === 'function') {
      const memUsage = process.memoryUsage()
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)

      this.logger.debug('Memory usage check', {
        context,
        heapUsedMB,
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      })

      // Trigger garbage collection if heap usage exceeds 500MB
      if (heapUsedMB > 500) {
        this.logger.warn('High memory usage detected, triggering garbage collection', {
          context,
          heapUsedMB,
        })
        global.gc()
      }
    }
  }

  /**
   * Validates execution configuration and adjusts settings if needed.
   * Implements adaptive configuration based on system resources.
   *
   * @private
   * @returns Adjusted execution configuration
   */
  private getAdaptiveConfig(): ExecutionConfig {
    // Check available memory and adjust thresholds accordingly
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      const availableHeapMB = Math.round((memUsage.heapTotal - memUsage.heapUsed) / 1024 / 1024)

      // If available heap is low, use smaller threshold to prefer exec over spawn
      if (availableHeapMB < 100) {
        this.logger.warn('Low memory detected, adjusting output size threshold', {
          availableHeapMB,
          originalThreshold: this.config.outputSizeThreshold,
          adjustedThreshold: this.config.outputSizeThreshold / 2,
        })

        return {
          ...this.config,
          outputSizeThreshold: this.config.outputSizeThreshold / 2,
        }
      }
    }

    return this.config
  }
}
