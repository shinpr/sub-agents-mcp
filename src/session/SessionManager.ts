import { mkdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { SessionConfig, SessionData, SessionEntry } from '../types/SessionData.js'

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
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(
        `Failed to create session directory at ${this.config.sessionDir}:`,
        errorMessage
      )
      throw new Error(`Session directory initialization failed: ${errorMessage}`)
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

  public async saveSession(
    sessionId: string,
    request: SessionEntry['request'],
    response: SessionEntry['response']
  ): Promise<void> {
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
    } catch (error) {
      this.logSaveError(sessionId, request.agent, error)
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
    const errorMessage = error instanceof Error ? error.message : String(error)
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
      const sessionData = JSON.parse(fileContent) as SessionData

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
      const sessionData = JSON.parse(fileContent) as SessionData

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

  private logLoadError(sessionId: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
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
              const errorMessage =
                deleteError instanceof Error ? deleteError.message : String(deleteError)
              console.error(`Failed to delete old session file: ${file}`, {
                file,
                error: errorMessage,
              })
            }
          }
        } catch (statError) {
          const errorMessage = statError instanceof Error ? statError.message : String(statError)
          console.error(`Failed to stat session file: ${file}`, {
            file,
            error: errorMessage,
          })
        }
      }

      if (deletedCount > 0) {
        console.log('Cleaned up old session files:', {
          deletedCount,
          deletedFiles,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to cleanup old sessions:', {
        error: errorMessage,
      })
    }
  }
}
