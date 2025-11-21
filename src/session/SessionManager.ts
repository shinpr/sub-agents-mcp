import { mkdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { SessionConfig, SessionData, SessionEntry } from '../types/SessionData'

/**
 * Session manager for handling session data persistence.
 *
 * Manages session data storage, retrieval, and cleanup operations.
 * Ensures secure file handling with directory traversal prevention.
 */
export class SessionManager {
  private readonly config: SessionConfig

  /**
   * Creates a new SessionManager instance.
   *
   * Initializes the session directory synchronously to ensure it exists
   * before any operations are performed.
   *
   * @param config - Session configuration containing directory path and retention settings
   */
  constructor(config: SessionConfig) {
    this.config = config
    this.initializeSessionDirectory()
  }

  /**
   * Initializes the session directory by creating it if it doesn't exist.
   * Uses synchronous file operations to ensure directory exists before returning.
   *
   * @private
   * @throws {Error} If directory creation fails
   */
  private initializeSessionDirectory(): void {
    try {
      mkdirSync(this.config.sessionDir, { recursive: true })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(
        `Failed to create session directory at ${this.config.sessionDir}:`,
        errorMessage
      )
      throw new Error(`Session directory initialization failed: ${errorMessage}`)
    }
  }

  /**
   * Validates a session ID to ensure it only contains allowed characters.
   * Prevents directory traversal attacks by rejecting IDs with path manipulation characters.
   *
   * Session IDs must:
   * - Not be empty
   * - Contain only alphanumeric characters, hyphens (-), and underscores (_)
   * - Not contain path traversal sequences (../, ./, etc.)
   *
   * @param sessionId - The session ID to validate
   * @throws {Error} If the session ID contains invalid characters or is empty
   */
  public validateSessionId(sessionId: string): void {
    if (!sessionId || sessionId.length === 0) {
      throw new Error('Invalid session ID: Session ID cannot be empty')
    }

    // Only allow alphanumeric characters, hyphens, and underscores
    const validPattern = /^[a-zA-Z0-9_-]+$/
    if (!validPattern.test(sessionId)) {
      throw new Error(
        `Invalid session ID: "${sessionId}" contains invalid characters. Only alphanumeric characters, hyphens (-), and underscores (_) are allowed`
      )
    }
  }

  /**
   * Builds a file path for a session file following the naming convention:
   * [session_id]_[agent_type]_[timestamp].json
   *
   * Security measures:
   * - Validates session ID before processing
   * - Uses path.basename to strip directory components
   * - Verifies final path is within session directory
   *
   * @param sessionId - The session identifier (validated for security)
   * @param agentType - The type of agent (e.g., 'rule-advisor', 'quality-fixer')
   * @param timestamp - Unix timestamp in milliseconds
   * @returns The full file path for the session file
   * @throws {Error} If the session ID is invalid or if path traversal is detected
   */
  public buildFilePath(sessionId: string, agentType: string, timestamp: number): string {
    // Validate session ID to prevent directory traversal
    this.validateSessionId(sessionId)

    // Build filename following the naming convention
    const fileName = `${sessionId}_${agentType}_${timestamp}.json`

    // Strip any directory components for additional security
    const safeFileName = path.basename(fileName)

    // Join with session directory
    const filePath = path.join(this.config.sessionDir, safeFileName)

    // Verify the resolved path stays within the session directory
    const normalizedPath = path.normalize(filePath)
    const normalizedSessionDir = path.normalize(this.config.sessionDir)

    if (!normalizedPath.startsWith(normalizedSessionDir)) {
      throw new Error(
        `Invalid file path: Attempted directory traversal detected. Expected path within "${normalizedSessionDir}", got "${normalizedPath}"`
      )
    }

    return filePath
  }

  /**
   * Saves session data to a JSON file.
   *
   * If a session file already exists, the new request-response pair is appended
   * to the existing history. Otherwise, a new session file is created.
   *
   * Error handling follows the error isolation principle:
   * - Errors are logged but not thrown
   * - The main execution flow continues even if session save fails
   *
   * Security features:
   * - Session ID validation prevents directory traversal
   * - File permissions are set to 0o600 (owner read/write only)
   * - All file paths are verified to stay within session directory
   *
   * @param sessionId - The session identifier (alphanumeric, hyphens, underscores only)
   * @param request - The request object containing agent, prompt, and optional parameters
   * @param response - The response object containing stdout, stderr, exitCode, and executionTime
   *
   * @example
   * await sessionManager.saveSession(
   *   'session-001',
   *   { agent: 'rule-advisor', prompt: 'Analyze code' },
   *   { stdout: 'Analysis complete', stderr: '', exitCode: 0, executionTime: 100 }
   * )
   */
  public async saveSession(
    sessionId: string,
    request: SessionEntry['request'],
    response: SessionEntry['response']
  ): Promise<void> {
    try {
      // Validate session ID to prevent directory traversal
      this.validateSessionId(sessionId)

      // Create session entry with current timestamp
      const sessionEntry: SessionEntry = {
        timestamp: new Date(),
        request,
        response,
      }

      // Build or update session data
      const sessionData = await this.buildSessionData(sessionId, request.agent, sessionEntry)

      // Build file path with current timestamp
      const timestamp = Date.now()
      const filePath = this.buildFilePath(sessionId, request.agent, timestamp)

      // Serialize to JSON with pretty printing
      const jsonContent = JSON.stringify(sessionData, null, 2)

      // Write to file with restrictive permissions
      await fs.writeFile(filePath, jsonContent, { mode: 0o600 })
    } catch (error) {
      // Log error but do not throw - error isolation principle
      this.logSaveError(sessionId, request.agent, error)
    }
  }

  /**
   * Builds session data by either creating a new session or appending to an existing one.
   *
   * @param sessionId - The session identifier
   * @param agentType - The agent type
   * @param sessionEntry - The new session entry to add
   * @returns Complete session data ready to be saved
   */
  private async buildSessionData(
    sessionId: string,
    agentType: string,
    sessionEntry: SessionEntry
  ): Promise<SessionData> {
    const existingSession = await this.loadExistingSession(sessionId, agentType)

    if (existingSession) {
      // Append to existing session history
      return {
        ...existingSession,
        history: [...existingSession.history, sessionEntry],
        lastUpdatedAt: new Date(),
      }
    }

    // Create new session with initial entry
    return {
      sessionId,
      agentType,
      history: [sessionEntry],
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
    }
  }

  /**
   * Logs structured error information when session save fails.
   *
   * @param sessionId - The session identifier
   * @param agentType - The agent type
   * @param error - The error that occurred
   */
  private logSaveError(sessionId: string, agentType: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Failed to save session:', {
      sessionId,
      agentType,
      error: errorMessage,
    })
  }

  /**
   * Loads a session by session ID.
   *
   * Searches for the most recent session file matching the session ID across all agent types.
   * If multiple files exist with the same session ID, returns the one with the latest timestamp.
   *
   * Error handling follows the error isolation principle:
   * - Returns null if session file does not exist
   * - Returns null if JSON parsing fails
   * - Errors are logged but not thrown
   *
   * @param sessionId - The session identifier (alphanumeric, hyphens, underscores only)
   * @returns The session data if found, null otherwise
   *
   * @example
   * const session = await sessionManager.loadSession('session-001')
   * if (session) {
   *   console.log(`Loaded session with ${session.history.length} entries`)
   * }
   */
  public async loadSession(sessionId: string): Promise<SessionData | null> {
    try {
      // Validate session ID to prevent directory traversal
      this.validateSessionId(sessionId)

      // List files in session directory
      const files = await fs.readdir(this.config.sessionDir)

      // Filter files matching the session ID (any agent type)
      // File naming convention: [session_id]_[agent_type]_[timestamp].json
      const sessionFiles = files
        .filter((file) => file.startsWith(`${sessionId}_`) && file.endsWith('.json'))
        .sort()
        .reverse() // Most recent first (lexicographic sort works because timestamp is at the end)

      if (sessionFiles.length === 0) {
        return null
      }

      // Select the most recent file (first in the reversed sorted list)
      const latestFile = sessionFiles[0]
      if (!latestFile) {
        return null
      }

      const filePath = path.join(this.config.sessionDir, latestFile)
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const sessionData = JSON.parse(fileContent) as SessionData

      // Convert date strings back to Date objects
      return {
        ...sessionData,
        createdAt: new Date(sessionData.createdAt),
        lastUpdatedAt: new Date(sessionData.lastUpdatedAt),
        history: sessionData.history.map((entry) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        })),
      }
    } catch (error) {
      // Log error but return null - error isolation principle
      this.logLoadError(sessionId, error)
      return null
    }
  }

  /**
   * Loads an existing session file if it exists.
   *
   * Searches for the most recent session file matching the session ID and agent type.
   *
   * @param sessionId - The session identifier
   * @param agentType - The agent type
   * @returns The session data if found, null otherwise
   */
  private async loadExistingSession(
    sessionId: string,
    agentType: string
  ): Promise<SessionData | null> {
    try {
      // List files in session directory
      const files = await fs.readdir(this.config.sessionDir)

      // Filter files matching the session ID and agent type
      const sessionFiles = files
        .filter((file) => file.startsWith(`${sessionId}_${agentType}_`))
        .sort()
        .reverse() // Most recent first

      if (sessionFiles.length === 0) {
        return null
      }

      // Read the most recent file
      const latestFile = sessionFiles[0]
      if (!latestFile) {
        return null
      }
      const filePath = path.join(this.config.sessionDir, latestFile)
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const sessionData = JSON.parse(fileContent) as SessionData

      // Convert date strings back to Date objects
      return {
        ...sessionData,
        createdAt: new Date(sessionData.createdAt),
        lastUpdatedAt: new Date(sessionData.lastUpdatedAt),
        history: sessionData.history.map((entry) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        })),
      }
    } catch {
      return null
    }
  }

  /**
   * Logs structured error information when session load fails.
   *
   * @param sessionId - The session identifier
   * @param error - The error that occurred
   */
  private logLoadError(sessionId: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Failed to load session:', {
      sessionId,
      error: errorMessage,
    })
  }

  /**
   * Cleans up old session files based on retention period.
   *
   * Deletes session files older than the configured retention period (default 7 days).
   * This is a best-effort operation - errors during deletion are logged but not thrown.
   *
   * Error handling follows the error isolation principle:
   * - Individual file deletion failures do not stop the cleanup process
   * - All errors are logged for debugging purposes
   * - The method completes successfully even if some files cannot be deleted
   *
   * @example
   * // Cleanup old sessions (runs silently, logs errors only)
   * await sessionManager.cleanupOldSessions()
   */
  public async cleanupOldSessions(): Promise<void> {
    try {
      // List all files in the session directory
      const files = await fs.readdir(this.config.sessionDir)

      // Calculate cutoff time based on retention period
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000
      const cutoffTime = Date.now() - retentionMs

      let deletedCount = 0
      const deletedFiles: string[] = []

      // Process each file
      for (const file of files) {
        // Skip non-JSON files
        if (!file.endsWith('.json')) {
          continue
        }

        const filePath = path.join(this.config.sessionDir, file)

        try {
          // Get file stats to check modification time
          const stats = await fs.stat(filePath)

          // Check if file is older than retention period
          if (stats.mtimeMs < cutoffTime) {
            try {
              // Delete the old file
              await fs.unlink(filePath)
              deletedCount++
              deletedFiles.push(file)
            } catch (deleteError) {
              // Log individual file deletion error but continue
              const errorMessage =
                deleteError instanceof Error ? deleteError.message : String(deleteError)
              console.error(`Failed to delete old session file: ${file}`, {
                file,
                error: errorMessage,
              })
            }
          }
        } catch (statError) {
          // Log stat error but continue with next file
          const errorMessage = statError instanceof Error ? statError.message : String(statError)
          console.error(`Failed to stat session file: ${file}`, {
            file,
            error: errorMessage,
          })
        }
      }

      // Log cleanup summary
      if (deletedCount > 0) {
        console.log('Cleaned up old session files:', {
          deletedCount,
          deletedFiles,
        })
      }
    } catch (error) {
      // Log error but do not throw - error isolation principle
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to cleanup old sessions:', {
        error: errorMessage,
      })
    }
  }
}
