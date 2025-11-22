/**
 * Session information
 *
 * Maintains historical request-response records from sub-agent executions.
 * Autonomously managed by the MCP server and shared across multiple clients.
 */
export interface SessionData {
  /** Only alphanumerics, hyphens, and underscores are allowed to prevent directory traversal attacks. */
  sessionId: string

  agentType: string
  history: SessionEntry[]

  /** Used to determine retention period during cleanup processing. */
  createdAt: Date

  lastUpdatedAt: Date
}

/**
 * Session history entry
 *
 * A request-response pair from a single sub-agent execution.
 */
export interface SessionEntry {
  timestamp: Date

  /** Has a structure compatible with ExecutionParams. */
  request: {
    agent: string
    prompt: string
    cwd?: string
    extra_args?: string[]
  }

  /** Has a structure compatible with ExecutionResult. */
  response: {
    stdout: string
    stderr: string
    exitCode: number
    executionTime: number
  }
}

/**
 * Session configuration
 *
 * Loaded from environment variables and used during SessionManager initialization.
 */
export interface SessionConfig {
  /** Controlled by the SESSION_ENABLED environment variable. */
  enabled: boolean

  /** Controlled by the SESSION_DIR environment variable. */
  sessionDir: string

  /** Controlled by the SESSION_RETENTION_DAYS environment variable. */
  retentionDays: number
}

/**
 * Session save result
 *
 * Due to error isolation design, main flow processing continues even if save fails.
 */
export interface SessionSaveResult {
  success: boolean
  sessionId: string

  /** File naming convention: [session_id]_[agent_type]_[timestamp].json */
  filePath?: string

  error?: string
}
