import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionConfig } from '../../types/SessionData'
import { SessionManager } from '../SessionManager'

describe('SessionManager', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    // Create a temporary test directory
    testSessionDir = path.join(os.tmpdir(), `test-sessions-${Date.now()}`)
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

  describe('constructor', () => {
    it('should create a SessionManager instance with valid config', async () => {
      const manager = new SessionManager(sessionConfig)
      expect(manager).toBeInstanceOf(SessionManager)

      // Verify that session directory was created
      const dirExists = await fs.stat(testSessionDir)
      expect(dirExists.isDirectory()).toBe(true)
    })

    it('should create session directory if it does not exist', async () => {
      const newDir = path.join(os.tmpdir(), `new-session-dir-${Date.now()}`)
      const newConfig: SessionConfig = {
        enabled: true,
        sessionDir: newDir,
        retentionDays: 7,
      }

      new SessionManager(newConfig)

      // Verify that directory was created
      const dirExists = await fs.stat(newDir)
      expect(dirExists.isDirectory()).toBe(true)

      // Cleanup
      await fs.rm(newDir, { recursive: true, force: true })
    })
  })

  describe('validateSessionId', () => {
    it('should accept valid session IDs with alphanumeric, hyphens, and underscores', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('abc123')).not.toThrow()
      expect(() => manager.validateSessionId('abc-123')).not.toThrow()
      expect(() => manager.validateSessionId('abc_123')).not.toThrow()
      expect(() => manager.validateSessionId('ABC-123_xyz')).not.toThrow()
    })

    it('should reject session IDs with directory traversal attempts', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('../etc')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('./local')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('../../etc')).toThrow('Invalid session ID')
    })

    it('should reject session IDs with special characters', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('abc@123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('abc/123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('abc\\123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('abc 123')).toThrow('Invalid session ID')
      expect(() => manager.validateSessionId('abc;123')).toThrow('Invalid session ID')
    })

    it('should reject empty session IDs', () => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId('')).toThrow('Invalid session ID')
    })
  })

  describe('buildFilePath', () => {
    it('should build file path with correct naming convention', () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-123'
      const agentType = 'rule-advisor'
      const timestamp = 1234567890000

      const filePath = manager.buildFilePath(sessionId, agentType, timestamp)

      // Expected format: [session_id]_[agent_type]_[timestamp].json
      const expectedFileName = `${sessionId}_${agentType}_${timestamp}.json`
      expect(filePath).toBe(path.join(testSessionDir, expectedFileName))
    })

    it('should prevent directory traversal in session ID', () => {
      const manager = new SessionManager(sessionConfig)
      const maliciousSessionId = '../etc/passwd'
      const agentType = 'rule-advisor'
      const timestamp = 1234567890000

      expect(() => manager.buildFilePath(maliciousSessionId, agentType, timestamp)).toThrow(
        'Invalid session ID'
      )
    })

    it('should ensure file path is within session directory', () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'valid-session'
      const agentType = 'rule-advisor'
      const timestamp = 1234567890000

      const filePath = manager.buildFilePath(sessionId, agentType, timestamp)

      // Verify that the resolved path is within the session directory
      const normalizedFilePath = path.normalize(filePath)
      const normalizedSessionDir = path.normalize(testSessionDir)
      expect(normalizedFilePath.startsWith(normalizedSessionDir)).toBe(true)
    })
  })

  describe('saveSession', () => {
    it('should save session data to JSON file with correct naming convention', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-001'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Test prompt',
        cwd: '/test/dir',
      }
      const response = {
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      await manager.saveSession(sessionId, request, response)

      // Verify that file was created
      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^test-session-001_rule-advisor_\d+\.json$/)

      // Verify file content
      const filePath = path.join(testSessionDir, files[0])
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const sessionData = JSON.parse(fileContent)

      expect(sessionData.sessionId).toBe(sessionId)
      expect(sessionData.agentType).toBe('rule-advisor')
      expect(sessionData.history).toHaveLength(1)
      expect(sessionData.history[0].request).toEqual(request)
      expect(sessionData.history[0].response).toEqual(response)
      expect(sessionData.createdAt).toBeDefined()
      expect(sessionData.lastUpdatedAt).toBeDefined()
    })

    it('should append to existing session file', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-002'
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

      // Save first session
      await manager.saveSession(sessionId, request1, response1)

      // Save second session (should append)
      await manager.saveSession(sessionId, request2, response2)

      // Verify that there's still only one file
      const files = await fs.readdir(testSessionDir)
      const sessionFiles = files.filter((file) => file.startsWith('test-session-002'))
      expect(sessionFiles.length).toBeGreaterThan(0)

      // Get the latest file
      const latestFile = sessionFiles.sort().pop()
      const filePath = path.join(testSessionDir, latestFile!)
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const sessionData = JSON.parse(fileContent)

      // Verify that both entries are in history
      expect(sessionData.history.length).toBeGreaterThanOrEqual(2)
      expect(sessionData.createdAt).toBeDefined()
      expect(sessionData.lastUpdatedAt).toBeDefined()
    })

    it('should set file permissions to 0o600', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-003'
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

      // Get the created file
      const files = await fs.readdir(testSessionDir)
      const filePath = path.join(testSessionDir, files[0])

      // Check file permissions
      const stats = await fs.stat(filePath)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
    })

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

      // Should not throw error even with invalid session ID
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

      // Verify that error was logged
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('loadSession', () => {
    it('should load an existing session successfully', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-load-001'
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

      // First, save a session
      await manager.saveSession(sessionId, request, response)

      // Then, load it
      const loadedSession = await manager.loadSession(sessionId)

      // Verify the loaded session
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.sessionId).toBe(sessionId)
      expect(loadedSession?.agentType).toBe('rule-advisor')
      expect(loadedSession?.history).toHaveLength(1)
      expect(loadedSession?.history[0].request).toEqual(request)
      expect(loadedSession?.history[0].response).toEqual(response)
      expect(loadedSession?.createdAt).toBeInstanceOf(Date)
      expect(loadedSession?.lastUpdatedAt).toBeInstanceOf(Date)
    })

    it('should return null when session file does not exist', async () => {
      const manager = new SessionManager(sessionConfig)
      const nonExistentSessionId = 'non-existent-session'

      const loadedSession = await manager.loadSession(nonExistentSessionId)

      expect(loadedSession).toBeNull()
    })

    it('should return null when JSON parse fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-invalid-json'

      // Create a file with invalid JSON
      const fileName = `${sessionId}_rule-advisor_${Date.now()}.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, 'invalid json content', 'utf-8')

      const loadedSession = await manager.loadSession(sessionId)

      expect(loadedSession).toBeNull()
    })

    it('should load the most recent session file when multiple files exist', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-multiple'
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

      // Save first session
      await manager.saveSession(sessionId, request1, response1)

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Save second session (creates a new file with appended history)
      await manager.saveSession(sessionId, request2, response2)

      // Load session - should get the most recent one
      const loadedSession = await manager.loadSession(sessionId)

      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(2)
    })
  })
})
