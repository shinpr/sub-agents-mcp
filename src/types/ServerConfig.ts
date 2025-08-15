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
   * Directory path containing agent definition files.
   * The server scans this directory for .md files containing agent definitions.
   */
  agentsDir: string

  /**
   * CLI command used to execute agents.
   * Typically 'claude-code' but can be customized for different environments.
   */
  cliCommand: string
}
