import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatSessionHistory } from '../../session/SessionHistoryFormatter.js'
import { SessionManager } from '../../session/SessionManager.js'
import type { SessionConfig } from '../../types/SessionData.js'

describe('Session Management - Acceptance Tests', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    testSessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acceptance-test-sessions-'))
    sessionConfig = {
      enabled: true,
      sessionDir: testSessionDir,
      retentionDays: 7,
    }
  })

  afterEach(async () => {
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true })
    } catch {}
  })

  describe('AC1: Environment variable configuration', () => {
    it('should enable session management when SESSION_ENABLED=true', () => {
      const enabledConfig: SessionConfig = {
        enabled: true,
        sessionDir: testSessionDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(enabledConfig)
      expect(manager).toBeInstanceOf(SessionManager)
    })

    it('should use custom SESSION_DIR when specified', async () => {
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-sessions-'))
      const customDir = path.join(parent, 'sessions')
      const customConfig: SessionConfig = {
        enabled: true,
        sessionDir: customDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(customConfig)
      expect(manager).toBeInstanceOf(SessionManager)

      const dirExists = await fs.stat(customDir)
      expect(dirExists.isDirectory()).toBe(true)

      await fs.rm(parent, { recursive: true, force: true })
    })

    it('should use custom SESSION_RETENTION_DAYS when specified', () => {
      const customRetentionConfig: SessionConfig = {
        enabled: true,
        sessionDir: testSessionDir,
        retentionDays: 14,
      }

      const manager = new SessionManager(customRetentionConfig)
      expect(manager).toBeInstanceOf(SessionManager)
    })
  })

  describe('AC2: Session save functionality', () => {
    it('should save session data with session_id specified', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac2-test-session'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Test prompt for AC2',
        cwd: '/test/dir',
      }
      const response = {
        stdout: 'Test output for AC2',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      await manager.saveSession(sessionId, request, response)

      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBeGreaterThan(0)

      const sessionFile = files.find((f) => f.startsWith(sessionId))
      expect(sessionFile).toBeDefined()

      if (sessionFile) {
        const filePath = path.join(testSessionDir, sessionFile)
        const fileContent = await fs.readFile(filePath, 'utf-8')
        const sessionData = JSON.parse(fileContent)

        expect(sessionData.sessionId).toBe(sessionId)
        expect(sessionData.agentType).toBe('rule-advisor')
        expect(sessionData.history).toHaveLength(1)
        expect(sessionData.history[0].request).toEqual(request)
        expect(sessionData.history[0].response).toEqual(response)
      }
    })
  })

  describe('AC3: Session load functionality', () => {
    it('should load existing session history when session_id is reused', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac3-test-session'
      const request1 = {
        agent: 'rule-advisor',
        prompt: 'First prompt',
        cwd: '/test/dir',
      }
      const response1 = {
        stdout: 'First output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      await manager.saveSession(sessionId, request1, response1)

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.sessionId).toBe(sessionId)
      expect(loadedSession?.history).toHaveLength(1)
      expect(loadedSession?.history[0].request).toEqual(request1)
      expect(loadedSession?.history[0].response).toEqual(response1)
    })

    it('should load session with multiple history entries', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac3-multi-history'
      const request1 = {
        agent: 'rule-advisor',
        prompt: 'First prompt',
      }
      const response1 = {
        stdout: 'First output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }
      const request2 = {
        agent: 'rule-advisor',
        prompt: 'Second prompt',
      }
      const response2 = {
        stdout: 'Second output',
        stderr: '',
        exitCode: 0,
        executionTime: 200,
      }

      await manager.saveSession(sessionId, request1, response1)
      await manager.saveSession(sessionId, request2, response2)

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('AC4: Session history formatting', () => {
    it('should convert session data to Markdown format', () => {
      const sessionData = {
        sessionId: 'ac4-test',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Test prompt',
            },
            response: {
              stdout: 'Test output',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
      }

      const markdown = formatSessionHistory(sessionData)

      expect(markdown).toContain('# Session History: rule-advisor')
      expect(markdown).toContain('## 1. User Request')
      expect(markdown).toContain('Test prompt')
      expect(markdown).toContain('## 1. Agent Response')
      expect(markdown).toContain('Test output')

      expect(markdown).not.toContain('ac4-test')
      expect(markdown).not.toContain('2025-01-21T12:00:00.000Z')
      expect(markdown).not.toContain('exitCode')
    })

    it('should preserve conversation flow across multiple interactions', () => {
      const sessionData = {
        sessionId: 'ac4-multi-test',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'First question',
            },
            response: {
              stdout: 'First answer',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:05:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Second question',
            },
            response: {
              stdout: 'Second answer',
              stderr: '',
              exitCode: 0,
              executionTime: 200,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:05:00Z'),
      }

      const markdown = formatSessionHistory(sessionData)

      expect(markdown).toContain('## 1. User Request')
      expect(markdown).toContain('First question')
      expect(markdown).toContain('## 1. Agent Response')
      expect(markdown).toContain('First answer')
      expect(markdown).toContain('## 2. User Request')
      expect(markdown).toContain('Second question')
      expect(markdown).toContain('## 2. Agent Response')
      expect(markdown).toContain('Second answer')
    })
  })

  describe('AC5: Markdown history is leaner than the stored JSON', () => {
    it('should carry the conversation without the JSON transport metadata', () => {
      const sessionData = {
        sessionId: 'token-reduction-test-session-id',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'This is a test prompt with some meaningful content',
            },
            response: {
              stdout: 'This is a test output with some meaningful content',
              stderr: '',
              exitCode: 0,
              executionTime: 150,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:05:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Another test prompt to add more data',
            },
            response: {
              stdout: 'Another test output',
              stderr: '',
              exitCode: 0,
              executionTime: 200,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:05:00Z'),
      }

      const markdownStr = formatSessionHistory(sessionData)

      // The point of the Markdown form is that it carries the conversation and
      // drops the transport metadata. Asserting a size ratio instead would only
      // restate a property of this fixture.
      expect(markdownStr).toContain('# Session History')
      expect(markdownStr).toContain('This is a test prompt with some meaningful content')
      expect(markdownStr).toContain('This is a test output with some meaningful content')
      expect(markdownStr).toContain('Another test prompt to add more data')
      expect(markdownStr).not.toContain('executionTime')
      expect(markdownStr).not.toContain('exitCode')
      expect(markdownStr).not.toContain('token-reduction-test-session-id')
    })
  })

  describe('AC6: File naming convention', () => {
    it('should save files with correct naming convention', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac6-naming-test'
      const agentType = 'rule-advisor'
      const request = {
        agent: agentType,
        prompt: 'Test prompt',
      }
      const response = {
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      await manager.saveSession(sessionId, request, response)

      const files = await fs.readdir(testSessionDir)
      const sessionFile = files.find((f) => f.startsWith(sessionId))

      expect(sessionFile).toBeDefined()
      expect(sessionFile).toBe(`${sessionId}_${agentType}.json`)
    })
  })

  describe('AC7: Cleanup functionality', () => {
    it('should delete session files older than retention days', async () => {
      const manager = new SessionManager(sessionConfig)

      const oldFileName = `old-session_rule-advisor_${Date.now()}.json`
      const oldFilePath = path.join(testSessionDir, oldFileName)
      await fs.writeFile(oldFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo)

      const recentFileName = `recent-session_rule-advisor_${Date.now()}.json`
      const recentFilePath = path.join(testSessionDir, recentFileName)
      await fs.writeFile(recentFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      await manager.cleanupOldSessions()

      const files = await fs.readdir(testSessionDir)
      expect(files).not.toContain(oldFileName)
      expect(files).toContain(recentFileName)
    })
  })

  describe('AC8: Error isolation', () => {
    it('should not throw error when session save fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const invalidSessionId = '../invalid/session'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Test prompt',
      }
      const response = {
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      // The caller must not be thrown at, but it does have to learn the save failed.
      await expect(manager.saveSession(invalidSessionId, request, response)).resolves.toMatchObject(
        { saved: false }
      )
    })

    it('should return null when session load fails without throwing error', async () => {
      const manager = new SessionManager(sessionConfig)
      const nonExistentSessionId = 'non-existent-session'

      const result = await manager.loadSession(nonExistentSessionId, 'rule-advisor')
      expect(result).toBeNull()
    })

    it('should not throw error when cleanup encounters permission errors', async () => {
      const manager = new SessionManager(sessionConfig)

      const fileName = `test-session_rule-advisor_${Date.now()}.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)

      await fs.chmod(filePath, 0o444)

      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      try {
        await fs.chmod(filePath, 0o644)
      } catch {}
    })
  })

  describe('AC9: Backward compatibility', () => {
    it('should not create session files when session_id is not specified', async () => {
      const _manager = new SessionManager(sessionConfig)

      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBe(0)
    })

    it('should allow SessionManager to be created with disabled config', () => {
      const disabledConfig: SessionConfig = {
        enabled: false,
        sessionDir: testSessionDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(disabledConfig)
      expect(manager).toBeInstanceOf(SessionManager)
    })
  })

  describe('AC10: Debuggability (JSON format)', () => {
    it('should save session files in readable JSON format', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac10-debug-test'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Test prompt for debugging',
        cwd: '/test/dir',
      }
      const response = {
        stdout: 'Test output for debugging',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      await manager.saveSession(sessionId, request, response)

      const files = await fs.readdir(testSessionDir)
      const sessionFile = files.find((f) => f.startsWith(sessionId))
      expect(sessionFile).toBeDefined()

      if (sessionFile) {
        const filePath = path.join(testSessionDir, sessionFile)
        const fileContent = await fs.readFile(filePath, 'utf-8')

        expect(() => JSON.parse(fileContent)).not.toThrow()

        expect(fileContent).toContain('\n')
        expect(fileContent).toContain('  ')

        const sessionData = JSON.parse(fileContent)
        expect(sessionData).toHaveProperty('sessionId')
        expect(sessionData).toHaveProperty('agentType')
        expect(sessionData).toHaveProperty('history')
        expect(sessionData).toHaveProperty('createdAt')
        expect(sessionData).toHaveProperty('lastUpdatedAt')
      }
    })

    it('should include complete request and response data for debugging', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac10-complete-data'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Detailed test prompt',
        cwd: '/test/dir',
        env: { TEST_VAR: 'value' },
      }
      const response = {
        stdout: 'Detailed test output',
        stderr: 'Warning message',
        exitCode: 0,
        executionTime: 150,
      }

      await manager.saveSession(sessionId, request, response)

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history[0].request).toEqual(request)
      expect(loadedSession?.history[0].response).toEqual(response)
    })

    it('should preserve unknown response fields across a save/load round trip', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac10-unknown-response-fields'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Response passthrough prompt',
      }
      const response = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        executionTime: 42,
        signal: 'SIGTERM',
        diagnostics: { retries: 2, truncated: false },
      }

      await manager.saveSession(sessionId, request, response)

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      expect(loadedSession?.history[0].response).toEqual(response)
    })

    it('should preserve unknown fields on the history entry itself', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac10-unknown-entry-fields'
      const filePath = manager.buildFilePath(sessionId, 'rule-advisor')

      await fs.mkdir(testSessionDir, { recursive: true })
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionId,
          agentType: 'rule-advisor',
          createdAt: '2025-01-01T00:00:00.000Z',
          lastUpdatedAt: '2025-01-01T00:00:00.000Z',
          traceId: 'trace-abc',
          history: [
            {
              timestamp: '2025-01-01T00:00:00.000Z',
              durationLabel: 'fast',
              request: { agent: 'rule-advisor', prompt: 'p' },
              response: { stdout: 'o', stderr: '', exitCode: 0, executionTime: 1 },
            },
          ],
        })
      )

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      expect(loadedSession).not.toBeNull()

      // Extra keys survive the round trip but are outside the declared type,
      // so they are read through a record view rather than a property access.
      const rawSession: Record<string, unknown> = { ...loadedSession }
      const rawEntry: Record<string, unknown> = { ...loadedSession?.history[0] }
      expect(rawSession['traceId']).toBe('trace-abc')
      expect(rawEntry['durationLabel']).toBe('fast')
    })

    it.each([
      ['sessionId', { sessionId: 42 }],
      ['agentType', { agentType: null }],
      ['createdAt', { createdAt: 'not-a-date' }],
      ['history', { history: 'not-an-array' }],
    ])('should reject a session file whose %s has the wrong type', async (_field, override) => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac10-invalid-known-field'
      const filePath = manager.buildFilePath(sessionId, 'rule-advisor')

      await fs.mkdir(testSessionDir, { recursive: true })
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionId,
          agentType: 'rule-advisor',
          createdAt: '2025-01-01T00:00:00.000Z',
          lastUpdatedAt: '2025-01-01T00:00:00.000Z',
          history: [],
          ...override,
        })
      )

      await expect(manager.loadSession(sessionId, 'rule-advisor')).resolves.toBeNull()
    })

    it.each([
      ['request.agent', { request: { agent: 42, prompt: 'p' } }],
      ['request.cwd', { request: { agent: 'a', prompt: 'p', cwd: 7 } }],
      [
        'response.exitCode',
        { response: { stdout: '', stderr: '', exitCode: 'zero', executionTime: 1 } },
      ],
      ['timestamp', { timestamp: 'not-a-date' }],
    ])('should reject a history entry whose %s has the wrong type', async (_field, override) => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'ac10-invalid-entry-field'
      const filePath = manager.buildFilePath(sessionId, 'rule-advisor')

      await fs.mkdir(testSessionDir, { recursive: true })
      await fs.writeFile(
        filePath,
        JSON.stringify({
          sessionId,
          agentType: 'rule-advisor',
          createdAt: '2025-01-01T00:00:00.000Z',
          lastUpdatedAt: '2025-01-01T00:00:00.000Z',
          history: [
            {
              timestamp: '2025-01-01T00:00:00.000Z',
              request: { agent: 'rule-advisor', prompt: 'p' },
              response: { stdout: 'o', stderr: '', exitCode: 0, executionTime: 1 },
              ...override,
            },
          ],
        })
      )

      await expect(manager.loadSession(sessionId, 'rule-advisor')).resolves.toBeNull()
    })
  })

  describe('Integration: Complete session workflow', () => {
    it('should handle complete session lifecycle', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'integration-test-session'

      const request1 = {
        agent: 'rule-advisor',
        prompt: 'First interaction',
      }
      const response1 = {
        stdout: 'First response',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }
      await manager.saveSession(sessionId, request1, response1)

      let loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      expect(loadedSession?.history).toHaveLength(1)

      const request2 = {
        agent: 'rule-advisor',
        prompt: 'Second interaction',
      }
      const response2 = {
        stdout: 'Second response',
        stderr: '',
        exitCode: 0,
        executionTime: 200,
      }
      await manager.saveSession(sessionId, request2, response2)

      loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(2)

      if (loadedSession) {
        const markdown = formatSessionHistory(loadedSession)
        expect(markdown).toBeDefined()
        expect(markdown).toContain('# Session History')
        expect(markdown.length).toBeGreaterThan(0)
      }

      await manager.cleanupOldSessions()
      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBeGreaterThan(0)
    })
  })
})
