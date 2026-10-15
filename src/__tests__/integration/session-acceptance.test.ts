import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
      }
    })

    it.each([
      [
        'request',
        {
          agent: 'rule-advisor',
          prompt: 'Detailed test prompt',
          cwd: '/test/dir',
          env: { TEST_VAR: 'value' },
        },
        {
          stdout: 'Detailed test output',
          stderr: 'Warning message',
          exitCode: 0,
          executionTime: 150,
        },
      ],
      [
        'response',
        { agent: 'rule-advisor', prompt: 'Response passthrough prompt' },
        {
          stdout: 'output',
          stderr: '',
          exitCode: 0,
          executionTime: 42,
          signal: 'SIGTERM',
          diagnostics: { retries: 2, truncated: false },
        },
      ],
    ])(
      'should preserve unknown %s fields across a save/load round trip',
      async (_side, request, response) => {
        const manager = new SessionManager(sessionConfig)
        const sessionId = 'ac10-unknown-fields'

        await manager.saveSession(sessionId, request, response)

        const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
        expect(loadedSession?.history[0].request).toEqual(request)
        expect(loadedSession?.history[0].response).toEqual(response)
      }
    )

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
})
