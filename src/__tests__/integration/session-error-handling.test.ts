import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../session/SessionManager.js'
import type { SessionConfig } from '../../types/SessionData.js'

describe('Session Management - Error Handling Tests', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    testSessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'error-test-sessions-'))
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

  describe('Session save failure handling', () => {
    it.each([
      ['an invalid session ID', '../invalid/session', 0o755, 'Invalid session ID'],
      ['a read-only session directory', 'test-readonly', 0o555, 'EACCES'],
    ])(
      'should report the failure without throwing when the save fails on %s',
      async (_cause, sessionId, directoryMode, expectedReason) => {
        await fs.chmod(testSessionDir, directoryMode)

        try {
          const manager = new SessionManager(sessionConfig)
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

          await expect(manager.saveSession(sessionId, request, response)).resolves.toMatchObject({
            saved: false,
            reason: expect.stringContaining(expectedReason),
          })
        } finally {
          await fs.chmod(testSessionDir, 0o755)
        }
      }
    )
  })

  describe('Session load failure handling', () => {
    it('should handle file system read errors gracefully', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'read-error-session'

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
      await manager.saveSession(sessionId, request, response)

      const files = await fs.readdir(testSessionDir)
      const sessionFile = files.find((f) => f.startsWith(sessionId))
      expect(sessionFile).toBeDefined()

      if (sessionFile) {
        const filePath = path.join(testSessionDir, sessionFile)

        await fs.chmod(filePath, 0o000)

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await manager.loadSession(sessionId, 'rule-advisor')
        expect(result).toBeNull()

        consoleErrorSpy.mockRestore()

        await fs.chmod(filePath, 0o644)
      }
    })

    it('should return null for invalid session ID without throwing', async () => {
      const manager = new SessionManager(sessionConfig)
      const invalidSessionId = '../../../etc/passwd'

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await manager.loadSession(invalidSessionId, 'rule-advisor')

      expect(result).toBeNull()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('File system error handling', () => {
    it('should handle directory read errors in cleanup', async () => {
      const inaccessibleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inaccessible-sessions-'))

      const inaccessibleConfig: SessionConfig = {
        enabled: true,
        sessionDir: inaccessibleDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(inaccessibleConfig)

      await fs.chmod(inaccessibleDir, 0o000)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      consoleErrorSpy.mockRestore()

      await fs.chmod(inaccessibleDir, 0o755)
      await fs.rm(inaccessibleDir, { recursive: true, force: true })
    })
  })
})
