import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../session/SessionManager'
import type { SessionConfig } from '../../types/SessionData'

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

      const filePath = manager.buildFilePath(sessionId, agentType)

      // Expected format: [session_id]_[agent_type].json
      const expectedFileName = `${sessionId}_${agentType}.json`
      expect(filePath).toBe(path.join(testSessionDir, expectedFileName))
    })

    it('should prevent directory traversal in session ID', () => {
      const manager = new SessionManager(sessionConfig)
      const maliciousSessionId = '../etc/passwd'
      const agentType = 'rule-advisor'

      expect(() => manager.buildFilePath(maliciousSessionId, agentType)).toThrow(
        'Invalid session ID'
      )
    })

    it('should ensure file path is within session directory', () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'valid-session'
      const agentType = 'rule-advisor'

      const filePath = manager.buildFilePath(sessionId, agentType)

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
      // File name should match: [session_id]_[agent_type].json
      expect(files[0]).toBe('test-session-001_rule-advisor.json')

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
      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

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

      const loadedSession = await manager.loadSession(nonExistentSessionId, 'rule-advisor')

      expect(loadedSession).toBeNull()
    })

    it('should return null when JSON parse fails', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'test-session-invalid-json'

      // Create a file with invalid JSON
      const fileName = `${sessionId}_rule-advisor.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, 'invalid json content', 'utf-8')

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

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

      // Save second session (appends to the same file)
      await manager.saveSession(sessionId, request2, response2)

      // Load session - should get both entries in history
      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBe(2)
    })

    it('should isolate sessions by agent type - CRITICAL for sub-agent isolation', async () => {
      // Red: This test should FAIL with current implementation
      // Current bug: loadSession(sessionId) ignores agent_type
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'shared-session-001'

      // Save session for rule-advisor
      const ruleAdvisorRequest = {
        agent: 'rule-advisor',
        prompt: 'Analyze code quality',
      }
      const ruleAdvisorResponse = {
        stdout: 'Rule advisor response',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }
      await manager.saveSession(sessionId, ruleAdvisorRequest, ruleAdvisorResponse)

      // Save session for task-executor (same session_id, different agent)
      const taskExecutorRequest = {
        agent: 'task-executor',
        prompt: 'Execute task',
      }
      const taskExecutorResponse = {
        stdout: 'Task executor response',
        stderr: '',
        exitCode: 0,
        executionTime: 200,
      }
      await manager.saveSession(sessionId, taskExecutorRequest, taskExecutorResponse)

      // Load session for rule-advisor with agent_type parameter
      const ruleAdvisorSession = await manager.loadSession(sessionId, 'rule-advisor')

      // Verify isolation: should ONLY get rule-advisor's session, NOT task-executor's
      expect(ruleAdvisorSession).not.toBeNull()
      expect(ruleAdvisorSession?.agentType).toBe('rule-advisor')
      expect(ruleAdvisorSession?.history).toHaveLength(1)
      expect(ruleAdvisorSession?.history[0].request.prompt).toBe('Analyze code quality')
      expect(ruleAdvisorSession?.history[0].response.stdout).toBe('Rule advisor response')

      // Load session for task-executor with agent_type parameter
      const taskExecutorSession = await manager.loadSession(sessionId, 'task-executor')

      // Verify isolation: should ONLY get task-executor's session, NOT rule-advisor's
      expect(taskExecutorSession).not.toBeNull()
      expect(taskExecutorSession?.agentType).toBe('task-executor')
      expect(taskExecutorSession?.history).toHaveLength(1)
      expect(taskExecutorSession?.history[0].request.prompt).toBe('Execute task')
      expect(taskExecutorSession?.history[0].response.stdout).toBe('Task executor response')
    })
  })

  describe('cleanupOldSessions', () => {
    it('should delete files older than retention days', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create test files with different ages
      const oldFileName = 'old-session_rule-advisor.json'
      const oldFilePath = path.join(testSessionDir, oldFileName)
      await fs.writeFile(oldFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set file modification time to 8 days ago (older than retention period)
      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo)

      // Create a recent file (within retention period)
      const recentFileName = 'recent-session_rule-advisor.json'
      const recentFilePath = path.join(testSessionDir, recentFileName)
      await fs.writeFile(recentFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Execute cleanup
      await manager.cleanupOldSessions()

      // Verify old file was deleted
      const files = await fs.readdir(testSessionDir)
      expect(files).not.toContain(oldFileName)
      expect(files).toContain(recentFileName)
    })

    it('should not delete files within retention period', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create a file that's 3 days old (within 7-day retention)
      const fileName = 'test-session_rule-advisor.json'
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set file modification time to 3 days ago
      const threeDaysAgo = new Date()
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
      await fs.utimes(filePath, threeDaysAgo, threeDaysAgo)

      // Execute cleanup
      await manager.cleanupOldSessions()

      // Verify file still exists
      const files = await fs.readdir(testSessionDir)
      expect(files).toContain(fileName)
    })

    it('should not throw error when cleanup fails', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create a file
      const fileName = 'test-session_rule-advisor.json'
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set to old date
      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)

      // Make file read-only to simulate delete failure
      await fs.chmod(filePath, 0o444)

      // Spy on console.error to verify error logging
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Should not throw error even if deletion fails
      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      consoleErrorSpy.mockRestore()

      // Try to restore permissions for cleanup (may fail if file was deleted)
      try {
        await fs.chmod(filePath, 0o644)
      } catch {
        // Ignore if file was already deleted
      }
    })

    it('should delete multiple old files in a single cleanup', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create two old files (different session IDs)
      const oldFile1 = 'old-session-1_rule-advisor.json'
      const oldFile2 = 'old-session-2_rule-advisor.json'
      const oldFilePath1 = path.join(testSessionDir, oldFile1)
      const oldFilePath2 = path.join(testSessionDir, oldFile2)
      await fs.writeFile(oldFilePath1, JSON.stringify({ test: 'data' }), 'utf-8')
      await fs.writeFile(oldFilePath2, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set both files to 8 days ago
      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(oldFilePath1, eightDaysAgo, eightDaysAgo)
      await fs.utimes(oldFilePath2, eightDaysAgo, eightDaysAgo)

      // Execute cleanup
      await manager.cleanupOldSessions()

      // Assert - focus on behavior: both old files are deleted
      const remainingFiles = await fs.readdir(testSessionDir)
      expect(remainingFiles).not.toContain(oldFile1)
      expect(remainingFiles).not.toContain(oldFile2)
    })
  })
})
