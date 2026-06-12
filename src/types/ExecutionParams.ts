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

  /**
   * Optional absolute file path to the agent definition file.
   * Used by backends that support file-based system prompts (e.g., Gemini's GEMINI_SYSTEM_MD).
   */
  agentFilePath?: string
}
