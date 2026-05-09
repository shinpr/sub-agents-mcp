import type { AgentPermission } from '../execution/AgentExecutor.js'

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

  /**
   * Optional per-call execution timeout override in milliseconds.
   *
   * When provided, this value is used in place of the executor's configured
   * default (ExecutionConfig.executionTimeout) for this single call only. The
   * executor never mutates its own config, so the override does not affect
   * later calls or other concurrent calls.
   *
   * Validation (input bounds) is performed by the caller (e.g. RunAgentTool).
   */
  timeoutMs?: number

  /**
   * Optional per-call permission/approval level override.
   *
   * When provided, this value is used in place of the executor's configured
   * default (ExecutionConfig.permission) for this single call only. The
   * executor never mutates its own config, so the override does not affect
   * later calls or other concurrent calls.
   */
  permission?: AgentPermission
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
