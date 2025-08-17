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
