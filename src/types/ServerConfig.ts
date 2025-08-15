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
   * CLI command used to execute agents.
   * Typically 'claude-code' but can be customized for different environments.
   */
  cliCommand: string

  /**
   * Maximum output size in bytes for agent execution.
   * When exceeded, execution switches to spawn mode.
   */
  maxOutputSize: number

  /**
   * Whether to enable agent definition caching.
   * Improves performance by caching parsed agent definitions.
   */
  enableCache: boolean

  /**
   * Log level for server operations.
   * Controls verbosity of server logging output.
   */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}
