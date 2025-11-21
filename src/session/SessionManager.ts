import { mkdirSync } from 'node:fs'
import * as path from 'node:path'
import type { SessionConfig } from '../types/SessionData'

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
}
