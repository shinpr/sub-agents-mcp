/**
 * Session information
 *
 * Maintains historical request-response records from sub-agent executions.
 * Autonomously managed by the MCP server and shared across multiple clients.
 */
export interface SessionData {
  /**
   * Session ID
   *
   * Unique session identifier. UUID v4 format is recommended.
   * Only alphanumerics, hyphens, and underscores are allowed to prevent directory traversal attacks.
   */
  sessionId: string

  /**
   * Agent type
   *
   * The type of agent used in this session (e.g., "rule-advisor", "cursor").
   * Used in file naming conventions.
   */
  agentType: string

  /**
   * List of session history entries
   *
   * Chronological records of past request-response pairs.
   * Stored in order from oldest to newest entries.
   */
  history: SessionEntry[]

  /**
   * Session creation timestamp
   *
   * The date and time when this session was first created.
   * Used to determine retention period during cleanup processing.
   */
  createdAt: Date

  /**
   * Last update timestamp
   *
   * The date and time when this session was last updated.
   * Updated each time a new request-response pair is added.
   */
  lastUpdatedAt: Date
}

/**
 * Session history entry
 *
 * A request-response pair from a single sub-agent execution.
 * Stored in chronological order within SessionData.history.
 */
export interface SessionEntry {
  /**
   * Entry timestamp
   *
   * The date and time when this request-response was recorded.
   * Used for ordering the history.
   */
  timestamp: Date

  /**
   * Request information
   *
   * Details of the request sent to the sub-agent.
   * Has a structure compatible with ExecutionParams.
   */
  request: {
    /**
     * Agent name
     *
     * The name of the executed agent (e.g., "rule-advisor", "quality-fixer").
     */
    agent: string

    /**
     * Prompt
     *
     * User instructions or questions sent to the agent.
     */
    prompt: string

    /**
     * Working directory (optional)
     *
     * The working directory path for agent execution.
     * If not specified, the current working directory is used.
     */
    cwd?: string

    /**
     * Additional arguments (optional)
     *
     * Additional command-line arguments passed during agent execution.
     */
    extra_args?: string[]
  }

  /**
   * Response information
   *
   * The result of sub-agent execution.
   * Has a structure compatible with ExecutionResult.
   */
  response: {
    /**
     * Standard output
     *
     * The standard output content from agent execution.
     * Contains the agent's primary responses and results.
     */
    stdout: string

    /**
     * Standard error output
     *
     * The standard error output content from agent execution.
     * May contain warning messages or debug information.
     */
    stderr: string

    /**
     * Exit code
     *
     * The exit code of the agent process.
     * 0 indicates successful completion, non-zero indicates an error.
     */
    exitCode: number

    /**
     * Execution time (milliseconds)
     *
     * The time taken for agent execution in milliseconds.
     * Used for performance analysis.
     */
    executionTime: number
  }
}

/**
 * Session configuration
 *
 * Configuration values that control the behavior of session management features.
 * Loaded from environment variables and used during SessionManager initialization.
 */
export interface SessionConfig {
  /**
   * Session management enabled flag
   *
   * When true, session save and load functionality is enabled.
   * When false, session functionality is completely disabled, maintaining existing behavior.
   * Controlled by the SESSION_ENABLED environment variable.
   */
  enabled: boolean

  /**
   * Session file storage directory
   *
   * The path to the directory where session JSON files are saved.
   * Automatically created if the directory does not exist.
   * Controlled by the SESSION_DIR environment variable.
   */
  sessionDir: string

  /**
   * Session file retention period (days)
   *
   * Session files older than this number of days are deleted during cleanup.
   * Best-effort execution: processing continues even if deletion fails.
   * Controlled by the SESSION_RETENTION_DAYS environment variable.
   */
  retentionDays: number
}

/**
 * Session save result
 *
 * Metadata representing the execution result of SessionManager.saveSession().
 * Due to error isolation design, main flow processing continues even if save fails.
 */
export interface SessionSaveResult {
  /**
   * Save success flag
   *
   * When true, the session file was saved successfully.
   * When false, save failed but only an error log is output and main flow processing continues.
   */
  success: boolean

  /**
   * Session ID
   *
   * The identifier of the session being saved.
   * Always set regardless of success or failure.
   */
  sessionId: string

  /**
   * Saved file path (optional)
   *
   * Set only when save is successful.
   * File naming convention: [session_id]_[agent_type]_[timestamp].json
   */
  filePath?: string

  /**
   * Error message (optional)
   *
   * Set only when save fails.
   * Contains detailed error information for debugging.
   */
  error?: string
}
