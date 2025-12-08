/**
 * Server configuration management class.
 *
 * Handles loading configuration from environment variables with fallback defaults,
 * validates configuration values, and provides type-safe access to server settings.
 *
 * Environment variables:
 * - SERVER_NAME: Name identifier for the MCP server (default: 'sub-agents-mcp-server')
 * - SERVER_VERSION: Version of the MCP server (default: '1.0.0')
 * - AGENTS_DIR: Directory containing agent definition files (REQUIRED - must be absolute path)
 * - AGENT_TYPE: Type of agent to use ('cursor' | 'claude') (default: 'cursor')
 * - LOG_LEVEL: Log level for server operations (default: 'info')
 * - SESSION_ENABLED: Enable session management functionality (default: false)
 * - SESSION_DIR: Directory for storing session files (default: '.mcp-sessions')
 * - SESSION_RETENTION_DAYS: Number of days to retain session files (default: 1)
 */
export class ServerConfig {
  /** Server name identifier used for MCP registration */
  public readonly serverName: string

  /** Server version used for identification */
  public readonly serverVersion: string

  /** Directory path containing agent definition markdown files */
  public readonly agentsDir: string

  /** Type of agent to use for execution */
  public readonly agentType: 'cursor' | 'claude' | 'gemini'

  /** Log level for server operations */
  public readonly logLevel: 'debug' | 'info' | 'warn' | 'error'

  /** Maximum execution timeout in milliseconds for agent execution */
  public readonly executionTimeoutMs: number

  /** Enable session management functionality */
  public readonly sessionEnabled: boolean

  /** Directory for storing session files */
  public readonly sessionDir: string

  /** Number of days to retain session files before cleanup */
  public readonly sessionRetentionDays: number

  /**
   * Creates a new ServerConfig instance by loading values from environment variables
   * or using default values.
   * @throws {Error} When AGENTS_DIR environment variable is not set
   */
  constructor() {
    this.serverName = process.env['SERVER_NAME'] || 'sub-agents-mcp'
    this.serverVersion = process.env['SERVER_VERSION'] || '0.1.0'

    // AGENTS_DIR is required for MCP to work correctly
    const agentsDir = process.env['AGENTS_DIR']
    if (!agentsDir) {
      throw new Error(
        'AGENTS_DIR environment variable is required.\n' +
          'Please set it to an absolute path in your MCP configuration.\n' +
          'Example for Cursor IDE (~/.cursor/mcp.json):\n' +
          '  "env": {\n' +
          '    "AGENTS_DIR": "/Users/username/projects/my-app/agents"\n' +
          '  }\n' +
          'Example for Claude Desktop:\n' +
          '  "env": {\n' +
          '    "AGENTS_DIR": "/Users/username/claude-agents"\n' +
          '  }'
      )
    }
    this.agentsDir = agentsDir

    this.agentType = (process.env['AGENT_TYPE'] as 'cursor' | 'claude' | 'gemini') || 'cursor'
    this.logLevel = (process.env['LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error') || 'info'

    const timeoutEnv = process.env['EXECUTION_TIMEOUT_MS']
    if (timeoutEnv?.trim()) {
      const parsedTimeout = Number.parseInt(timeoutEnv, 10)
      this.executionTimeoutMs = Number.isNaN(parsedTimeout) ? 300000 : parsedTimeout
    } else {
      this.executionTimeoutMs = 300000
    }

    // Session management configuration
    // Only 'true' string enables session management, all other values are treated as false
    this.sessionEnabled = process.env['SESSION_ENABLED'] === 'true'
    this.sessionDir = process.env['SESSION_DIR'] || '.mcp-sessions'

    // Parse SESSION_RETENTION_DAYS with validation (must be positive integer)
    const retentionDaysEnv = process.env['SESSION_RETENTION_DAYS']
    if (retentionDaysEnv?.trim()) {
      const parsedDays = Number.parseInt(retentionDaysEnv, 10)
      // Use default (1 day) for invalid values (NaN, zero, or negative)
      this.sessionRetentionDays = Number.isNaN(parsedDays) || parsedDays <= 0 ? 1 : parsedDays
    } else {
      this.sessionRetentionDays = 1
    }
  }
}
