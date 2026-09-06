import { mkdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { SessionConfig, SessionData, SessionEntry } from '../types/SessionData.js'
import { toErrorMessage } from '../utils/ErrorHandler.js'

export interface SessionSaveResult {
  saved: boolean

  /** Present only when `saved` is false. */
  reason?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function malformed(field: string): Error {
  return new Error(`Session file contains a malformed "${field}" field`)
}

function readString(source: Record<string, unknown>, field: string): string {
  const value = source[field]
  if (typeof value !== 'string') {
    throw malformed(field)
  }
  return value
}

function readOptionalString(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw malformed(field)
  }
  return value
}

function readNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field]
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw malformed(field)
  }
  return value
}

function readDate(source: Record<string, unknown>, field: string): Date {
  const value = source[field]
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw malformed(field)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw malformed(field)
  }
  return date
}

function readRecord(source: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = source[field]
  if (!isRecord(value)) {
    throw malformed(field)
  }
  return value
}

function parseSessionEntry(value: unknown): SessionEntry {
  if (!isRecord(value)) {
    throw malformed('history entry')
  }

  const request = readRecord(value, 'request')
  const response = readRecord(value, 'response')
  const cwd = readOptionalString(request, 'cwd')

  return {
    ...value,
    timestamp: readDate(value, 'timestamp'),
    request: {
      ...request,
      agent: readString(request, 'agent'),
      prompt: readString(request, 'prompt'),
      ...(cwd !== undefined && { cwd }),
    },
    response: {
      ...response,
      stdout: readString(response, 'stdout'),
      stderr: readString(response, 'stderr'),
      exitCode: readNumber(response, 'exitCode'),
      executionTime: readNumber(response, 'executionTime'),
    },
  }
}

/**
 * Parses a persisted session file. Session files are plain JSON on disk, so the
 * shape is validated and timestamps are revived rather than trusted as-is.
 * Throws when the content does not describe a session; callers treat that as a
 * cache miss.
 */
function parseSessionData(fileContent: string): SessionData {
  const parsed: unknown = JSON.parse(fileContent)
  if (!isRecord(parsed)) {
    throw new Error('Session file does not contain session data')
  }

  const history = parsed['history']
  if (!Array.isArray(history)) {
    throw malformed('history')
  }

  return {
    ...parsed,
    sessionId: readString(parsed, 'sessionId'),
    agentType: readString(parsed, 'agentType'),
    createdAt: readDate(parsed, 'createdAt'),
    lastUpdatedAt: readDate(parsed, 'lastUpdatedAt'),
    history: history.map(parseSessionEntry),
  }
}

export class SessionManager {
  private readonly config: SessionConfig

  constructor(config: SessionConfig) {
    this.config = config
    this.initializeSessionDirectory()
  }

  private initializeSessionDirectory(): void {
    try {
      mkdirSync(this.config.sessionDir, { recursive: true })
    } catch (error) {
      const errorMessage = toErrorMessage(error)
      console.error(
        `Failed to create session directory at ${this.config.sessionDir}:`,
        errorMessage
      )
      throw new Error(`Session directory initialization failed: ${errorMessage}`, {
        cause: error,
      })
    }
  }

  public validateSessionId(sessionId: string): void {
    if (!sessionId || sessionId.length === 0) {
      throw new Error('Invalid session ID: Session ID cannot be empty')
    }

    const validPattern = /^[a-zA-Z0-9_-]+$/
    if (!validPattern.test(sessionId)) {
      throw new Error(
        `Invalid session ID: "${sessionId}" contains invalid characters. Only alphanumeric characters, hyphens (-), and underscores (_) are allowed`
      )
    }
  }

  public buildFilePath(sessionId: string, agentType: string): string {
    this.validateSessionId(sessionId)
    const fileName = `${sessionId}_${agentType}.json`
    const safeFileName = path.basename(fileName)
    const filePath = path.join(this.config.sessionDir, safeFileName)
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
   * Persists one exchange. A failure is reported back rather than thrown, so the
   * caller can keep the agent's result while telling the user the history was
   * not stored.
   */
  public async saveSession(
    sessionId: string,
    request: SessionEntry['request'],
    response: SessionEntry['response']
  ): Promise<SessionSaveResult> {
    try {
      this.validateSessionId(sessionId)
      const sessionEntry: SessionEntry = {
        timestamp: new Date(),
        request,
        response,
      }

      const sessionData = await this.buildSessionData(sessionId, request.agent, sessionEntry)
      const filePath = this.buildFilePath(sessionId, request.agent)
      const jsonContent = JSON.stringify(sessionData, null, 2)
      await fs.writeFile(filePath, jsonContent, { mode: 0o600 })
      return { saved: true }
    } catch (error) {
      this.logSaveError(sessionId, request.agent, error)
      return { saved: false, reason: toErrorMessage(error) }
    }
  }

  private async buildSessionData(
    sessionId: string,
    agentType: string,
    sessionEntry: SessionEntry
  ): Promise<SessionData> {
    const existingSession = await this.loadExistingSession(sessionId, agentType)

    if (existingSession) {
      return {
        ...existingSession,
        history: [...existingSession.history, sessionEntry],
        lastUpdatedAt: new Date(),
      }
    }

    return {
      sessionId,
      agentType,
      history: [sessionEntry],
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
    }
  }

  private logSaveError(sessionId: string, agentType: string, error: unknown): void {
    const errorMessage = toErrorMessage(error)
    console.error('Failed to save session:', {
      sessionId,
      agentType,
      error: errorMessage,
    })
  }

  public async loadSession(sessionId: string, agentType: string): Promise<SessionData | null> {
    try {
      this.validateSessionId(sessionId)
      const filePath = this.buildFilePath(sessionId, agentType)
      try {
        await fs.access(filePath)
      } catch {
        return null
      }
      const fileContent = await fs.readFile(filePath, 'utf-8')
      return parseSessionData(fileContent)
    } catch (error) {
      this.logLoadError(sessionId, error)
      return null
    }
  }

  private async loadExistingSession(
    sessionId: string,
    agentType: string
  ): Promise<SessionData | null> {
    try {
      const filePath = this.buildFilePath(sessionId, agentType)
      try {
        await fs.access(filePath)
      } catch {
        return null
      }
      const fileContent = await fs.readFile(filePath, 'utf-8')
      return parseSessionData(fileContent)
    } catch {
      return null
    }
  }

  private logLoadError(sessionId: string, error: unknown): void {
    const errorMessage = toErrorMessage(error)
    console.error('Failed to load session:', {
      sessionId,
      error: errorMessage,
    })
  }

  public async cleanupOldSessions(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.sessionDir)
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000
      const cutoffTime = Date.now() - retentionMs

      let deletedCount = 0
      const deletedFiles: string[] = []

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue
        }

        const filePath = path.join(this.config.sessionDir, file)

        try {
          const stats = await fs.stat(filePath)
          if (stats.mtimeMs < cutoffTime) {
            try {
              await fs.unlink(filePath)
              deletedCount++
              deletedFiles.push(file)
            } catch (deleteError) {
              const errorMessage = toErrorMessage(deleteError)
              console.error(`Failed to delete old session file: ${file}`, {
                file,
                error: errorMessage,
              })
            }
          }
        } catch (statError) {
          const errorMessage = toErrorMessage(statError)
          console.error(`Failed to stat session file: ${file}`, {
            file,
            error: errorMessage,
          })
        }
      }

      if (deletedCount > 0) {
        // stdout carries the MCP protocol stream, so every diagnostic goes to stderr.
        console.error('Cleaned up old session files:', {
          deletedCount,
          deletedFiles,
        })
      }
    } catch (error) {
      const errorMessage = toErrorMessage(error)
      console.error('Failed to cleanup old sessions:', {
        error: errorMessage,
      })
    }
  }
}
