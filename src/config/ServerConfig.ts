import {
  AGENT_EFFORT_SUPPORTED_TYPES,
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

export class ServerConfig {
  public readonly serverName: string

  public readonly serverVersion: string

  public readonly agentsDir: string

  public readonly agentType: AgentType

  public readonly agentPermission: AgentPermission

  public readonly agentModel: string | undefined

  public readonly agentEffort: string | undefined

  public readonly logLevel: LogLevel

  public readonly executionTimeoutMs: number

  public readonly sessionEnabled: boolean

  public readonly sessionDir: string

  public readonly sessionRetentionDays: number

  public readonly agentsSettingsPath: string | undefined

  public readonly cursorApiKey: string | undefined

  public readonly glmApiKey: string | undefined

  public readonly kimiApiKey: string | undefined

  constructor() {
    this.serverName = process.env['SERVER_NAME'] || 'sub-agents-mcp'
    this.serverVersion = process.env['SERVER_VERSION'] || '0.1.0'

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
      throw new Error(
        'AGENT_TYPE environment variable is required. ' +
          `Set it to one of: ${AGENT_TYPES.join(', ')} in your MCP configuration, ` +
          'then restart or reconnect the MCP server.'
      )
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
          `Supported types: ${AGENT_EFFORT_SUPPORTED_TYPES.join(', ')}.`
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

    this.sessionEnabled = process.env['SESSION_ENABLED'] === 'true'
    this.sessionDir = process.env['SESSION_DIR'] || '.mcp-sessions'

    const retentionDaysEnv = process.env['SESSION_RETENTION_DAYS']
    if (retentionDaysEnv?.trim()) {
      const parsedDays = Number.parseInt(retentionDaysEnv, 10)
      this.sessionRetentionDays = Number.isNaN(parsedDays) || parsedDays <= 0 ? 1 : parsedDays
    } else {
      this.sessionRetentionDays = 1
    }

    this.agentsSettingsPath = process.env['AGENTS_SETTINGS_PATH'] || undefined

    // Cursor API key: prefer CURSOR_API_KEY, fall back to CLI_API_KEY for backward compatibility
    const cursorApiKeyEnv = process.env['CURSOR_API_KEY'] || process.env['CLI_API_KEY']
    this.cursorApiKey = cursorApiKeyEnv?.trim() ? cursorApiKeyEnv : undefined

    const cliApiKeyEnv = process.env['CLI_API_KEY']
    const cliApiKey = cliApiKeyEnv?.trim() ? cliApiKeyEnv : undefined
    this.glmApiKey = cliApiKey
    this.kimiApiKey = cliApiKey
  }
}
