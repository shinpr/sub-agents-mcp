/**
 * Server configuration management class.
 *
 * Handles loading configuration from environment variables with fallback defaults,
 * validates configuration values, and provides type-safe access to server settings.
 *
 * Environment variables:
 * - SERVER_NAME: Name identifier for the MCP server (default: 'sub-agents-mcp-server')
 * - SERVER_VERSION: Version of the MCP server (default: '1.0.0')
 * - AGENTS_DIR: Directory containing agent definition files (default: './agents')
 * - AGENT_TYPE: Type of agent to use ('cursor' | 'claude') (default: 'cursor')
 * - LOG_LEVEL: Log level for server operations (default: 'info')
 */
export class ServerConfig {
  /** Server name identifier used for MCP registration */
  public readonly serverName: string

  /** Server version used for identification */
  public readonly serverVersion: string

  /** Directory path containing agent definition markdown files */
  public readonly agentsDir: string

  /** Type of agent to use for execution */
  public readonly agentType: 'cursor' | 'claude'

  /** Log level for server operations */
  public readonly logLevel: 'debug' | 'info' | 'warn' | 'error'

  /** Maximum execution timeout in milliseconds for agent execution */
  public readonly executionTimeoutMs: number

  /**
   * Creates a new ServerConfig instance by loading values from environment variables
   * or using default values.
   */
  constructor() {
    this.serverName = process.env['SERVER_NAME'] || 'sub-agents-mcp'
    this.serverVersion = process.env['SERVER_VERSION'] || '0.1.0'
    this.agentsDir = process.env['AGENTS_DIR'] || './agents'
    this.agentType = (process.env['AGENT_TYPE'] as 'cursor' | 'claude') || 'cursor'
    this.logLevel = (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') || 'info'

    const timeoutEnv = process.env['EXECUTION_TIMEOUT_MS']
    if (timeoutEnv?.trim()) {
      const parsedTimeout = Number.parseInt(timeoutEnv, 10)
      this.executionTimeoutMs = Number.isNaN(parsedTimeout) ? 300000 : parsedTimeout
    } else {
      this.executionTimeoutMs = 300000
    }
  }
}
