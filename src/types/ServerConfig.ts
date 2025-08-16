/**
 * Configuration interface for the MCP server.
 * Defines the structure for server configuration parameters
 * loaded from environment variables or defaults.
 */
export interface ServerConfigInterface {
  /**
   * Name identifier of the MCP server.
   * Used in server registration and client communication.
   */
  serverName: string

  /**
   * Version of the MCP server.
   * Used in server identification and client compatibility checking.
   */
  serverVersion: string

  /**
   * Directory path containing agent definition files.
   * The server scans this directory for .md files containing agent definitions.
   */
  agentsDir: string

  /**
   * Type of agent to use for execution.
   * 'cursor' or 'claude'
   */
  agentType: 'cursor' | 'claude'

  /**
   * Log level for server operations.
   * Controls verbosity of server logging output.
   */
  logLevel: 'debug' | 'info' | 'warn' | 'error'

  /**
   * Maximum execution timeout in milliseconds for agent execution.
   * Configurable via EXECUTION_TIMEOUT_MS environment variable.
   * Default: 90000ms (90 seconds), Range: 1000ms - 240000ms (4 minutes)
   */
  executionTimeoutMs: number
}
