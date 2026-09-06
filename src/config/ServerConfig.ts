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

const DEFAULT_EXECUTION_TIMEOUT_MS = 300000
const DEFAULT_SESSION_RETENTION_DAYS = 1

const MISSING_AGENTS_DIR_ERROR =
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

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function resolveAgentsDir(): string {
  const agentsDir = process.env['AGENTS_DIR']
  if (!agentsDir) {
    throw new Error(MISSING_AGENTS_DIR_ERROR)
  }
  return agentsDir
}

function resolveAgentType(): AgentType {
  const value = readEnv('AGENT_TYPE')
  if (!value) {
    throw new Error(
      'AGENT_TYPE environment variable is required. ' +
        `Set it to one of: ${AGENT_TYPES.join(', ')} in your MCP configuration, ` +
        'then restart or reconnect the MCP server.'
    )
  }
  if (!isAgentType(value)) {
    throw new Error(`Invalid AGENT_TYPE: "${value}". Must be one of: ${AGENT_TYPES.join(', ')}.`)
  }
  return value
}

function resolveAgentPermission(): AgentPermission {
  const value = readEnv('AGENT_PERMISSION')
  if (!value) {
    return DEFAULT_AGENT_PERMISSION
  }
  if (!isAgentPermission(value)) {
    throw new Error(
      `Invalid AGENT_PERMISSION: "${value}". Must be one of: ${AGENT_PERMISSIONS.join(', ')}.`
    )
  }
  return value
}

function resolveAgentEffort(agentType: AgentType): string | undefined {
  const value = readEnv('AGENT_EFFORT')
  if (value && !supportsAgentEffort(agentType)) {
    throw new Error(
      `AGENT_EFFORT is not supported for AGENT_TYPE="${agentType}". ` +
        `Supported types: ${AGENT_EFFORT_SUPPORTED_TYPES.join(', ')}.`
    )
  }
  return value
}

function resolveLogLevel(): LogLevel {
  const value = readEnv('LOG_LEVEL')
  if (!value) {
    return 'info'
  }
  if (!isLogLevel(value)) {
    throw new Error(`Invalid LOG_LEVEL: "${value}". Must be one of: ${LOG_LEVELS.join(', ')}.`)
  }
  return value
}

/**
 * Parses a duration in milliseconds. `Number.parseInt` alone would read "5min"
 * as 5, silently turning every execution into an instant timeout, so the whole
 * value has to be a positive integer.
 */
function resolveExecutionTimeoutMs(): number {
  const value = readEnv('EXECUTION_TIMEOUT_MS')
  if (!value) {
    return DEFAULT_EXECUTION_TIMEOUT_MS
  }

  // Restricted to plain decimal digits: "1e6" and "0x10" are valid to Number()
  // but are not what anyone means to write in a millisecond setting.
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid EXECUTION_TIMEOUT_MS: "${value}". ` +
        'Expected a positive whole number of milliseconds. ' +
        `"${value}" is not one, and a value like "5min" would be read as 5 milliseconds. ` +
        `Use ${DEFAULT_EXECUTION_TIMEOUT_MS} for 5 minutes. ` +
        'Update "env" in your MCP configuration and restart the server.'
    )
  }
  return parsed
}

function resolveSessionRetentionDays(): number {
  const value = readEnv('SESSION_RETENTION_DAYS')
  if (!value) {
    return DEFAULT_SESSION_RETENTION_DAYS
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_SESSION_RETENTION_DAYS : parsed
}

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
    this.agentsDir = resolveAgentsDir()
    this.agentType = resolveAgentType()
    this.agentPermission = resolveAgentPermission()
    this.agentModel = readEnv('AGENT_MODEL')
    this.agentEffort = resolveAgentEffort(this.agentType)
    this.logLevel = resolveLogLevel()
    this.executionTimeoutMs = resolveExecutionTimeoutMs()
    this.sessionEnabled = process.env['SESSION_ENABLED'] === 'true'
    this.sessionDir = process.env['SESSION_DIR'] || '.mcp-sessions'
    this.sessionRetentionDays = resolveSessionRetentionDays()
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
