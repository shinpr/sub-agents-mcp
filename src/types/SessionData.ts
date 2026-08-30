export interface SessionData {
  sessionId: string

  agentType: string
  history: SessionEntry[]

  createdAt: Date

  lastUpdatedAt: Date
}

export interface SessionEntry {
  timestamp: Date

  request: {
    agent: string
    prompt: string
    cwd?: string
    extra_args?: string[]
  }

  response: {
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
