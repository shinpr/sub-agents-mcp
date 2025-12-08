import { type ChildProcess, spawn } from 'node:child_process'
import type { ExecutionParams } from 'src/types/ExecutionParams'
import { type LogLevel, Logger } from 'src/utils/Logger'
import { StreamProcessor } from './StreamProcessor'

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
   * Whether a result JSON was successfully obtained from the agent.
   * True when StreamProcessor detects a valid JSON response.
   */
  hasResult?: boolean

  /**
   * The parsed JSON result from the agent if available.
   * Contains the structured response data when hasResult is true.
   */
  resultJson?: unknown
}

/**
 * Simplified execution configuration.
 */
export interface ExecutionConfig {
  /**
   * Maximum execution timeout in milliseconds.
   * Default: 5 minutes (300000ms)
   */
  executionTimeout: number

  /**
   * Type of agent to use for execution.
   * 'cursor', 'claude', or 'gemini'
   */
  agentType: 'cursor' | 'claude' | 'gemini'
}

export const DEFAULT_EXECUTION_TIMEOUT = 300000 // 5 minutes

/**
 * Creates a complete ExecutionConfig with the provided agent type.
 * @param agentType - The type of agent to use
 * @param overrides - Optional overrides for thresholds
 */
export function createExecutionConfig(
  agentType: 'cursor' | 'claude' | 'gemini',
  overrides?: Partial<Omit<ExecutionConfig, 'agentType'>>
): ExecutionConfig {
  return {
    executionTimeout: DEFAULT_EXECUTION_TIMEOUT,
    ...overrides,
    agentType,
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

      // Execute using spawn for proper TTY handling
      const result = await this.executeWithSpawn(params)

      const executionTime = Date.now() - startTime

      this.logger.info('Agent execution completed', {
        requestId,
        exitCode: result.exitCode,
        executionTime,
        hasResult: result.hasResult,
      })

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime,
        ...(result.hasResult !== undefined && { hasResult: result.hasResult }),
        ...(result.resultJson !== undefined && { resultJson: result.resultJson }),
      }
    } catch (error) {
      const executionTime = Date.now() - startTime

      this.logger.error('Agent execution failed', error instanceof Error ? error : undefined, {
        requestId,
        executionTime,
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
        hasResult: false,
        resultJson: undefined,
      }
    }
  }

  /**
   * Executes an agent using child_process.spawn for proper TTY handling.
   *
   * @private
   * @param params - Execution parameters
   * @returns Promise resolving to execution result
   */
  private async executeWithSpawn(params: ExecutionParams): Promise<{
    stdout: string
    stderr: string
    exitCode: number
    hasResult?: boolean
    resultJson?: unknown
  }> {
    return new Promise((resolve) => {
      // Generate command and args - both CLIs use the same interface
      const formattedPrompt = `[System Context]\n${params.agent}\n\n[User Prompt]\n${params.prompt}`
      const args = ['--output-format', 'json', '-p', formattedPrompt]

      // Determine command based on agent type
      const command =
        this.config.agentType === 'claude'
          ? 'claude'
          : this.config.agentType === 'gemini'
            ? 'gemini'
            : 'cursor-agent'

      // Add API key for cursor-cli if available
      if (this.config.agentType === 'cursor' && process.env['CLI_API_KEY']) {
        args.push('-a', process.env['CLI_API_KEY'])
      }

      this.logger.debug('Executing with spawn', {
        command,
        cwd: params.cwd || process.cwd(),
      })

      // Spawn process
      const childProcess: ChildProcess = spawn(command, args, {
        cwd: params.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'], // stdin set to 'ignore' as cursor-agent receives prompt via args
        shell: false,
        env: process.env,
      })

      // Initialize stream processor and buffers
      const streamProcessor = new StreamProcessor()
      let stdout = ''
      let stderr = ''
      let stdoutBuffer = ''

      // No need to handle stdin as it's set to 'ignore'
      const executionTimeout = setTimeout(() => {
        this.logger.warn('Execution timeout reached', {
          timeout: this.config.executionTimeout,
        })
        childProcess.kill('SIGTERM')

        // Get any result collected so far
        const result = streamProcessor.getResult()
        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr: stderr || `Execution timeout: ${this.config.executionTimeout}ms`,
          exitCode: 124, // Standard timeout exit code
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
      }, this.config.executionTimeout)

      // Handle stdout stream with simplified processing
      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk
        stdoutBuffer += chunk

        // Process complete lines
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          // Process line returns true when final JSON is detected
          const isComplete = streamProcessor.processLine(line)

          if (isComplete) {
            // Ensure stdout contains the complete JSON result
            const completeResult = streamProcessor.getResult()
            if (completeResult) {
              stdout = JSON.stringify(completeResult)
            }
            // Processing complete, kill the process
            childProcess.kill('SIGTERM')
            break
          }
        }
      })

      // Handle stderr stream
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      childProcess.on('close', (code: number | null) => {
        clearTimeout(executionTimeout)

        // Get the final result JSON
        const result = streamProcessor.getResult()

        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr,
          exitCode: code || 0,
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
      })

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        clearTimeout(executionTimeout)

        // Get any result collected before error
        const result = streamProcessor.getResult()

        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr: stderr || error.message,
          exitCode: 1,
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
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
}
