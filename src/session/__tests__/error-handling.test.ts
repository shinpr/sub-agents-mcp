import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionConfig } from '../../types/SessionData'
import { SessionManager } from '../SessionManager'

/**
 * Error handling tests for session management feature.
 *
 * These tests verify that the system continues to operate correctly
 * even when errors occur, following the error isolation principle:
 * - Session save failures do not block main execution
 * - Session load failures return null gracefully
 * - File system errors are handled gracefully
 * - Session history formatting uses Markdown for optimal LLM context
 */
describe('Session Management - Error Handling Tests', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    // Create a temporary test directory
    testSessionDir = path.join(os.tmpdir(), `error-test-sessions-${Date.now()}`)
    sessionConfig = {
      enabled: true,
      sessionDir: testSessionDir,
      retentionDays: 7,
    }
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true })
    } catch {
      // Ignore errors if directory doesn't exist
    }
  })

  /**
   * Session save failure tests
   */
  describe('Session save failure handling', () => {
    it('should not throw error when session save fails with invalid session ID', async () => {
      const manager = new SessionManager(sessionConfig)
      const invalidSessionId = '../../../etc/passwd'
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

      // Should not throw error
      await expect(
        manager.saveSession(invalidSessionId, request, response)
      ).resolves.toBeUndefined()
    })

    it('should log error when session save fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const invalidSessionId = '../invalid'
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

      // Spy on console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await manager.saveSession(invalidSessionId, request, response)

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorCalls = consoleErrorSpy.mock.calls
      const hasSaveError = errorCalls.some((call) =>
        JSON.stringify(call).includes('Failed to save session')
      )
      expect(hasSaveError).toBe(true)

      consoleErrorSpy.mockRestore()
    })

    it('should handle file system write errors gracefully', async () => {
      // Create a read-only directory to simulate write failure
      const readOnlyDir = path.join(os.tmpdir(), `readonly-sessions-${Date.now()}`)
      await fs.mkdir(readOnlyDir, { mode: 0o555 })

      const readOnlyConfig: SessionConfig = {
        enabled: true,
        sessionDir: readOnlyDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(readOnlyConfig)
      const sessionId = 'test-readonly'
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

      // Should not throw error even when directory is read-only
      await expect(manager.saveSession(sessionId, request, response)).resolves.toBeUndefined()

      // Cleanup: restore permissions and delete directory
      await fs.chmod(readOnlyDir, 0o755)
      await fs.rm(readOnlyDir, { recursive: true, force: true })
    })

    it('should continue main flow even when session save fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const invalidSessionId = '../invalid'
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

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Save should complete without throwing
      await manager.saveSession(invalidSessionId, request, response)

      // Main flow continues - we can still use the manager
      const validSessionId = 'valid-session'
      await manager.saveSession(validSessionId, request, response)

      // Verify valid session was saved
      const loadedSession = await manager.loadSession(validSessionId)
      expect(loadedSession).not.toBeNull()

      consoleErrorSpy.mockRestore()
    })
  })

  /**
   * Session load failure tests
   */
  describe('Session load failure handling', () => {
    it('should return null when session file does not exist', async () => {
      const manager = new SessionManager(sessionConfig)
      const nonExistentSessionId = 'non-existent-session'

      const result = await manager.loadSession(nonExistentSessionId)

      expect(result).toBeNull()
    })

    it('should return null when JSON parse fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'invalid-json-session'

      // Create a file with invalid JSON
      const fileName = `${sessionId}_rule-advisor_${Date.now()}.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, 'invalid json content {{{', 'utf-8')

      const result = await manager.loadSession(sessionId)

      expect(result).toBeNull()
    })

    it('should log error when session load fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'load-error-session'

      // Create a file with invalid JSON
      const fileName = `${sessionId}_rule-advisor_${Date.now()}.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, 'invalid json', 'utf-8')

      // Spy on console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await manager.loadSession(sessionId)

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalled()
      const errorCalls = consoleErrorSpy.mock.calls
      const hasLoadError = errorCalls.some((call) =>
        JSON.stringify(call).includes('Failed to load session')
      )
      expect(hasLoadError).toBe(true)

      consoleErrorSpy.mockRestore()
    })

    it('should handle file system read errors gracefully', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'read-error-session'

      // Create a session file
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

      // Find the created file
      const files = await fs.readdir(testSessionDir)
      const sessionFile = files.find((f) => f.startsWith(sessionId))
      expect(sessionFile).toBeDefined()

      if (sessionFile) {
        const filePath = path.join(testSessionDir, sessionFile)

        // Make file unreadable
        await fs.chmod(filePath, 0o000)

        // Mock console.error to suppress error output
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        // Should return null without throwing
        const result = await manager.loadSession(sessionId)
        expect(result).toBeNull()

        consoleErrorSpy.mockRestore()

        // Restore permissions for cleanup
        await fs.chmod(filePath, 0o644)
      }
    })

    it('should return null for invalid session ID without throwing', async () => {
      const manager = new SessionManager(sessionConfig)
      const invalidSessionId = '../../../etc/passwd'

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await manager.loadSession(invalidSessionId)

      expect(result).toBeNull()

      consoleErrorSpy.mockRestore()
    })
  })

  /**
   * File system error tests
   */
  describe('File system error handling', () => {
    it('should handle directory read errors in cleanup', async () => {
      // Create a directory and then make it inaccessible
      const inaccessibleDir = path.join(os.tmpdir(), `inaccessible-sessions-${Date.now()}`)
      await fs.mkdir(inaccessibleDir, { mode: 0o755 })

      const inaccessibleConfig: SessionConfig = {
        enabled: true,
        sessionDir: inaccessibleDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(inaccessibleConfig)

      // Make directory inaccessible
      await fs.chmod(inaccessibleDir, 0o000)

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Cleanup should not throw error
      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      consoleErrorSpy.mockRestore()

      // Restore permissions and cleanup
      await fs.chmod(inaccessibleDir, 0o755)
      await fs.rm(inaccessibleDir, { recursive: true, force: true })
    })

    it('should continue cleanup even when individual file deletion fails', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create multiple old files
      const fileCount = 5
      const filePaths: string[] = []

      for (let i = 0; i < fileCount; i++) {
        const fileName = `old-session-${i}_rule-advisor_${Date.now() + i}.json`
        const filePath = path.join(testSessionDir, fileName)
        await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')
        filePaths.push(filePath)

        // Set file modification time to 8 days ago
        const eightDaysAgo = new Date()
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
        await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)
      }

      // Make the middle file read-only to simulate deletion failure
      if (filePaths[2]) {
        await fs.chmod(filePaths[2], 0o444)
      }

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Cleanup should not throw error
      await manager.cleanupOldSessions()

      consoleErrorSpy.mockRestore()

      // Restore permissions for cleanup
      for (const filePath of filePaths) {
        try {
          await fs.chmod(filePath, 0o644)
        } catch {
          // Ignore if file was already deleted
        }
      }
    })

    it('should handle stat errors during cleanup', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create a file
      const fileName = `test-session_rule-advisor_${Date.now()}.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set to old date
      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)

      // Make file inaccessible (can't stat)
      await fs.chmod(filePath, 0o000)

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Cleanup should not throw error
      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      consoleErrorSpy.mockRestore()

      // Restore permissions for cleanup
      try {
        await fs.chmod(filePath, 0o644)
      } catch {
        // Ignore if file was already deleted
      }
    })
  })

  /**
   * Validation error tests
   */
  describe('Validation error handling', () => {
    it('should reject empty session ID', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('')).toThrow('Invalid session ID')
    })

    it('should reject session ID with special characters', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('session@123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('session/123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('session\\123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('session 123')).toThrow('Invalid session ID')
    })

    it('should reject session ID with directory traversal attempts', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('../etc')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('./local')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('../../etc')).toThrow('Invalid session ID')
    })

    it('should reject session ID with path separators', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('session/id')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('session\\id')).toThrow('Invalid session ID')
    })
  })

  /**
   * Recovery and resilience tests
   */
  describe('Recovery and resilience', () => {
    it('should recover from save failure and continue with valid operations', async () => {
      const manager = new SessionManager(sessionConfig)

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // First, try to save with invalid session ID
      const invalidSessionId = '../invalid'
      const request1 = {
        agent: 'rule-advisor',
        prompt: 'Invalid prompt',
      }
      const response1 = {
        stdout: 'Invalid output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }
      await manager.saveSession(invalidSessionId, request1, response1)

      // Then, save with valid session ID
      const validSessionId = 'valid-recovery-test'
      const request2 = {
        agent: 'rule-advisor',
        prompt: 'Valid prompt',
      }
      const response2 = {
        stdout: 'Valid output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }
      await manager.saveSession(validSessionId, request2, response2)

      // Verify valid session was saved
      const loadedSession = await manager.loadSession(validSessionId)
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.sessionId).toBe(validSessionId)

      consoleErrorSpy.mockRestore()
    })

    it('should handle multiple concurrent error scenarios', async () => {
      const manager = new SessionManager(sessionConfig)

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Try multiple invalid operations concurrently
      const promises = [
        manager.saveSession(
          '../invalid1',
          { agent: 'test', prompt: 'test' },
          { stdout: '', stderr: '', exitCode: 0, executionTime: 0 }
        ),
        manager.saveSession(
          '../invalid2',
          { agent: 'test', prompt: 'test' },
          { stdout: '', stderr: '', exitCode: 0, executionTime: 0 }
        ),
        manager.loadSession('non-existent-1'),
        manager.loadSession('non-existent-2'),
      ]

      // All should complete without throwing
      await expect(Promise.all(promises)).resolves.toBeDefined()

      consoleErrorSpy.mockRestore()
    })

    it('should maintain data integrity after error recovery', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'integrity-test'

      // Mock console.error to suppress error output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Save first entry
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
      await manager.saveSession(sessionId, request1, response1)

      // Try to save with invalid ID (should fail but not affect valid session)
      await manager.saveSession(
        '../invalid',
        { agent: 'test', prompt: 'test' },
        { stdout: '', stderr: '', exitCode: 0, executionTime: 0 }
      )

      // Save second entry to the valid session
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
      await manager.saveSession(sessionId, request2, response2)

      // Verify data integrity
      const loadedSession = await manager.loadSession(sessionId)
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(2)

      consoleErrorSpy.mockRestore()
    })
  })
})
