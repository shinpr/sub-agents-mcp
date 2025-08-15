/**
 * Parameters for executing an AI agent through the MCP server.
 * These parameters are passed to the run_agent tool to initiate agent execution.
 */
export interface ExecutionParams {
  /**
   * Name of the agent to execute.
   * Must match a loaded agent definition name.
   */
  agent: string

  /**
   * User prompt/instructions to send to the agent.
   * This is the input that will be processed by the agent.
   */
  prompt: string

  /**
   * Optional working directory for the agent execution.
   * If not provided, uses the current working directory.
   */
  cwd?: string

  /**
   * Optional additional command line arguments.
   * These are passed to the Claude Code CLI when executing the agent.
   */
  extra_args?: string[]
}

/**
 * Result returned from agent execution.
 * Contains the execution status and output/error information.
 */
export interface ExecutionResult {
  /**
   * Whether the agent execution was successful.
   * True indicates successful completion, false indicates failure.
   */
  success: boolean

  /**
   * Output content from the agent execution.
   * Contains the agent's response or execution result.
   */
  output: string

  /**
   * Error message if execution failed.
   * Only present when success is false.
   */
  error?: string
}

/**
 * Type guard to check if an unknown value is a valid ExecutionParams.
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid ExecutionParams
 *
 * @example
 * ```typescript
 * if (isExecutionParams(params)) {
 *   // params is now typed as ExecutionParams
 *   console.log(params.agent)
 * }
 * ```
 */
export function isExecutionParams(value: unknown): value is ExecutionParams {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj['agent'] === 'string' &&
    obj['agent'].length > 0 &&
    typeof obj['prompt'] === 'string' &&
    obj['prompt'].length > 0 &&
    (obj['cwd'] === undefined || typeof obj['cwd'] === 'string') &&
    (obj['extra_args'] === undefined ||
      (Array.isArray(obj['extra_args']) &&
        obj['extra_args'].every((arg) => typeof arg === 'string')))
  )
}

/**
 * Type guard to check if an unknown value is a valid ExecutionResult.
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid ExecutionResult
 *
 * @example
 * ```typescript
 * if (isExecutionResult(result)) {
 *   // result is now typed as ExecutionResult
 *   console.log(result.success)
 * }
 * ```
 */
export function isExecutionResult(value: unknown): value is ExecutionResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj['success'] === 'boolean' &&
    typeof obj['output'] === 'string' &&
    (obj['error'] === undefined || typeof obj['error'] === 'string')
  )
}
