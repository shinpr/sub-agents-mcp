import type {
  SessionConfig,
  SessionData,
  SessionEntry,
  SessionSaveResult,
} from 'src/types/SessionData'
import { describe, expect, it } from 'vitest'

describe('SessionData', () => {
  it('should have required properties: sessionId, agentType, history, createdAt, lastUpdatedAt', () => {
    const sessionData: SessionData = {
      sessionId: 'test-session-123',
      agentType: 'rule-advisor',
      history: [],
      createdAt: new Date('2025-01-21T12:00:00Z'),
      lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
    }

    expect(sessionData.sessionId).toBe('test-session-123')
    expect(sessionData.agentType).toBe('rule-advisor')
    expect(sessionData.history).toEqual([])
    expect(sessionData.createdAt).toBeInstanceOf(Date)
    expect(sessionData.lastUpdatedAt).toBeInstanceOf(Date)
  })

  it('should support history array with SessionEntry items', () => {
    const sessionEntry: SessionEntry = {
      timestamp: new Date('2025-01-21T12:00:00Z'),
      request: {
        agent: 'rule-advisor',
        prompt: 'Test prompt',
      },
      response: {
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 1234,
      },
    }

    const sessionData: SessionData = {
      sessionId: 'test-session-123',
      agentType: 'rule-advisor',
      history: [sessionEntry],
      createdAt: new Date('2025-01-21T12:00:00Z'),
      lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
    }

    expect(sessionData.history.length).toBe(1)
    expect(sessionData.history[0]).toEqual(sessionEntry)
  })

  it('should validate sessionId and agentType are non-empty strings', () => {
    const sessionData: SessionData = {
      sessionId: 'valid-session-id',
      agentType: 'valid-agent-type',
      history: [],
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
    }

    expect(sessionData.sessionId.length).toBeGreaterThan(0)
    expect(sessionData.agentType.length).toBeGreaterThan(0)
  })
})

describe('SessionEntry', () => {
  it('should have required properties: timestamp, request, response', () => {
    const sessionEntry: SessionEntry = {
      timestamp: new Date('2025-01-21T12:00:00Z'),
      request: {
        agent: 'rule-advisor',
        prompt: 'Test prompt',
      },
      response: {
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 1234,
      },
    }

    expect(sessionEntry.timestamp).toBeInstanceOf(Date)
    expect(sessionEntry.request).toBeDefined()
    expect(sessionEntry.response).toBeDefined()
  })

  it('should support optional cwd and extra_args in request', () => {
    const sessionEntry: SessionEntry = {
      timestamp: new Date('2025-01-21T12:00:00Z'),
      request: {
        agent: 'rule-advisor',
        prompt: 'Test prompt',
        cwd: '/path/to/project',
        extra_args: ['--verbose'],
      },
      response: {
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 1234,
      },
    }

    expect(sessionEntry.request.cwd).toBe('/path/to/project')
    expect(sessionEntry.request.extra_args).toEqual(['--verbose'])
  })

  it('should have response with stdout, stderr, exitCode, executionTime', () => {
    const sessionEntry: SessionEntry = {
      timestamp: new Date(),
      request: {
        agent: 'test-agent',
        prompt: 'Test prompt',
      },
      response: {
        stdout: 'Success output',
        stderr: 'Warning message',
        exitCode: 0,
        executionTime: 5678,
      },
    }

    expect(sessionEntry.response.stdout).toBe('Success output')
    expect(sessionEntry.response.stderr).toBe('Warning message')
    expect(sessionEntry.response.exitCode).toBe(0)
    expect(sessionEntry.response.executionTime).toBe(5678)
  })
})

describe('SessionConfig', () => {
  it('should have required properties: enabled, sessionDir, retentionDays', () => {
    const sessionConfig: SessionConfig = {
      enabled: true,
      sessionDir: '/tmp/mcp-sessions',
      retentionDays: 7,
    }

    expect(sessionConfig.enabled).toBe(true)
    expect(sessionConfig.sessionDir).toBe('/tmp/mcp-sessions')
    expect(sessionConfig.retentionDays).toBe(7)
  })

  it('should support disabled configuration', () => {
    const sessionConfig: SessionConfig = {
      enabled: false,
      sessionDir: '/tmp/mcp-sessions',
      retentionDays: 7,
    }

    expect(sessionConfig.enabled).toBe(false)
  })

  it('should validate retentionDays is a number', () => {
    const sessionConfig: SessionConfig = {
      enabled: true,
      sessionDir: '/tmp/mcp-sessions',
      retentionDays: 14,
    }

    expect(typeof sessionConfig.retentionDays).toBe('number')
  })
})

describe('SessionSaveResult', () => {
  it('should have required properties: success, sessionId and optional filePath, error', () => {
    const successResult: SessionSaveResult = {
      success: true,
      sessionId: 'test-session-123',
      filePath: '/tmp/mcp-sessions/test-session-123_rule-advisor_20250121T120000Z.json',
    }

    expect(successResult.success).toBe(true)
    expect(successResult.sessionId).toBe('test-session-123')
    expect(successResult.filePath).toBeDefined()
    expect(successResult.error).toBeUndefined()
  })

  it('should support error property for failed saves', () => {
    const errorResult: SessionSaveResult = {
      success: false,
      sessionId: 'test-session-123',
      error: 'Failed to write session file',
    }

    expect(errorResult.success).toBe(false)
    expect(errorResult.sessionId).toBe('test-session-123')
    expect(errorResult.error).toBe('Failed to write session file')
    expect(errorResult.filePath).toBeUndefined()
  })

  it('should have sessionId as non-empty string', () => {
    const result: SessionSaveResult = {
      success: true,
      sessionId: 'valid-session-id',
    }

    expect(result.sessionId.length).toBeGreaterThan(0)
  })
})
