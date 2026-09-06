export interface SessionData {
  sessionId: string

  agentType: string
  history: SessionEntry[]

  createdAt: Date

  lastUpdatedAt: Date
}

export interface SessionEntry {
  timestamp: Date

  /**
   * Extra keys beyond the documented ones are preserved verbatim so a saved
   * session stays fully inspectable when debugging.
   */
  request: {
    [key: string]: unknown
    agent: string
    prompt: string
    cwd?: string
  }

  response: {
    [key: string]: unknown
    stdout: string
    stderr: string
    exitCode: number
    executionTime: number
  }
}

export interface SessionConfig {
  enabled: boolean

  sessionDir: string

  retentionDays: number
}
