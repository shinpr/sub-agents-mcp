import {
  AGENT_PERMISSIONS,
  AGENT_TYPES,
  type AgentPermission,
  type AgentType,
  DEFAULT_AGENT_PERMISSION,
  isAgentPermission,
  isAgentType,
  supportsAgentEffort,
} from '../execution/AgentExecutor.js'
import { isLogLevel, LOG_LEVELS, type LogLevel } from '../utils/Logger.js'

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
 * - AGENT_TYPE: Type of agent to use (default: 'cursor')
 * - AGENT_PERMISSION: Approval/sandbox level for sub-agents ('read-only' | 'safe-edit' | 'yolo') (default: 'safe-edit')
 * - AGENT_MODEL: Optional model override for every agent execution
 * - AGENT_EFFORT: Optional backend-specific reasoning effort/model variant
 * - LOG_LEVEL: Log level for server operations (default: 'info')
 * - SESSION_ENABLED: Enable session management functionality (default: false)
 * - SESSION_DIR: Directory for storing session files (default: '.mcp-sessions')
 * - SESSION_RETENTION_DAYS: Number of days to retain session files (default: 1)
 * - AGENTS_SETTINGS_PATH: Path to CLI settings file/directory (optional)
 */
export class ServerConfig {
  /** Server name identifier used for MCP registration */
  public readonly serverName: string

  /** Server version used for identification */
  public readonly serverVersion: string

  /** Directory path containing agent definition markdown files */
  public readonly agentsDir: string

  /** Type of agent to use for execution */
  public readonly agentType: AgentType

  /** Approval/sandbox level for sub-agent execution */
  public readonly agentPermission: AgentPermission

  /** Optional model override applied to every execution */
  public readonly agentModel: string | undefined

  /** Optional backend-specific reasoning effort or model variant */
  public readonly agentEffort: string | undefined

  /** Log level for server operations */
  public readonly logLevel: LogLevel

  /** Maximum execution timeout in milliseconds for agent execution */
  public readonly executionTimeoutMs: number

  /** Enable session management functionality */
  public readonly sessionEnabled: boolean

  /** Directory for storing session files */
  public readonly sessionDir: string

  /** Number of days to retain session files before cleanup */
  public readonly sessionRetentionDays: number

  /** Path to CLI settings file/directory for agent execution */
  public readonly agentsSettingsPath: string | undefined

  /** API key for cursor-agent authentication (from CURSOR_API_KEY or CLI_API_KEY env var) */
  public readonly cursorApiKey: string | undefined

  /** API key for GLM/Z.ai authentication (from CLI_API_KEY env var) */
  public readonly glmApiKey: string | undefined

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

    const agentTypeEnv = process.env['AGENT_TYPE']?.trim()
    if (!agentTypeEnv) {
      this.agentType = 'cursor'
    } else if (isAgentType(agentTypeEnv)) {
      this.agentType = agentTypeEnv
    } else {
      throw new Error(
        `Invalid AGENT_TYPE: "${agentTypeEnv}". Must be one of: ${AGENT_TYPES.join(', ')}.`
      )
    }

    const agentPermissionEnv = process.env['AGENT_PERMISSION']?.trim()
    if (!agentPermissionEnv) {
      this.agentPermission = DEFAULT_AGENT_PERMISSION
    } else if (isAgentPermission(agentPermissionEnv)) {
      this.agentPermission = agentPermissionEnv
    } else {
      throw new Error(
        `Invalid AGENT_PERMISSION: "${agentPermissionEnv}". Must be one of: ${AGENT_PERMISSIONS.join(', ')}.`
      )
    }

    const agentModelEnv = process.env['AGENT_MODEL']?.trim()
    this.agentModel = agentModelEnv || undefined

    const agentEffortEnv = process.env['AGENT_EFFORT']?.trim()
    this.agentEffort = agentEffortEnv || undefined
    if (this.agentEffort && !supportsAgentEffort(this.agentType)) {
      throw new Error(
        `AGENT_EFFORT is not supported for AGENT_TYPE="${this.agentType}". ` +
          'Supported types: codex, claude, glm, grok, opencode.'
      )
    }

    const logLevelEnv = process.env['LOG_LEVEL']?.trim()
    if (!logLevelEnv) {
      this.logLevel = 'info'
    } else if (isLogLevel(logLevelEnv)) {
      this.logLevel = logLevelEnv
    } else {
      throw new Error(
        `Invalid LOG_LEVEL: "${logLevelEnv}". Must be one of: ${LOG_LEVELS.join(', ')}.`
      )
    }

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

    // CLI settings path (optional)
    // Used to specify custom settings file/directory for each CLI:
    // - Claude: passed as --settings argument
    // - Cursor: set as CURSOR_CONFIG_DIR environment variable
    // - Codex: set as CODEX_HOME environment variable
    // - Gemini/Grok/OpenCode: not supported (upstream limitation or normal config discovery)
    this.agentsSettingsPath = process.env['AGENTS_SETTINGS_PATH'] || undefined

    // Cursor API key: prefer CURSOR_API_KEY, fall back to CLI_API_KEY for backward compatibility
    const cursorApiKeyEnv = process.env['CURSOR_API_KEY'] || process.env['CLI_API_KEY']
    this.cursorApiKey = cursorApiKeyEnv?.trim() ? cursorApiKeyEnv : undefined

    const glmApiKeyEnv = process.env['CLI_API_KEY']
    this.glmApiKey = glmApiKeyEnv?.trim() ? glmApiKeyEnv : undefined
  }
}
