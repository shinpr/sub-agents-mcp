import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../session/SessionManager.js'
import type { SessionConfig } from '../../types/SessionData.js'

describe('SessionManager', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    testSessionDir = path.join(os.tmpdir(), `test-sessions-${Date.now()}`)
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

  describe('constructor', () => {
    it('should create a SessionManager instance with valid config', async () => {
      const manager = new SessionManager(sessionConfig)
      expect(manager).toBeInstanceOf(SessionManager)

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

      const dirExists = await fs.stat(newDir)
      expect(dirExists.isDirectory()).toBe(true)

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

      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBe(1)
      expect(files[0]).toBe('test-session-001_rule-advisor.json')

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

      await manager.saveSession(sessionId, request1, response1)

      await manager.saveSession(sessionId, request2, response2)

      const files = await fs.readdir(testSessionDir)
      const sessionFiles = files.filter((file) => file.startsWith('test-session-002'))
      expect(sessionFiles.length).toBeGreaterThan(0)

      const latestFile = sessionFiles.sort().pop()
      const filePath = path.join(testSessionDir, latestFile!)
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const sessionData = JSON.parse(fileContent)

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

      const files = await fs.readdir(testSessionDir)
      const filePath = path.join(testSessionDir, files[0])

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

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await manager.saveSession(invalidSessionId, request, response)

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

      await manager.saveSession(sessionId, request, response)

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

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

      await manager.saveSession(sessionId, request1, response1)

      await manager.saveSession(sessionId, request2, response2)

      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')

      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBe(2)
    })

    it('should isolate sessions by agent type - CRITICAL for sub-agent isolation', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'shared-session-001'

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

      const ruleAdvisorSession = await manager.loadSession(sessionId, 'rule-advisor')

      expect(ruleAdvisorSession).not.toBeNull()
      expect(ruleAdvisorSession?.agentType).toBe('rule-advisor')
      expect(ruleAdvisorSession?.history).toHaveLength(1)
      expect(ruleAdvisorSession?.history[0].request.prompt).toBe('Analyze code quality')
      expect(ruleAdvisorSession?.history[0].response.stdout).toBe('Rule advisor response')

      const taskExecutorSession = await manager.loadSession(sessionId, 'task-executor')

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

      const oldFileName = 'old-session_rule-advisor.json'
      const oldFilePath = path.join(testSessionDir, oldFileName)
      await fs.writeFile(oldFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo)

      const recentFileName = 'recent-session_rule-advisor.json'
      const recentFilePath = path.join(testSessionDir, recentFileName)
      await fs.writeFile(recentFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      await manager.cleanupOldSessions()

      const files = await fs.readdir(testSessionDir)
      expect(files).not.toContain(oldFileName)
      expect(files).toContain(recentFileName)
    })

    it('should not delete files within retention period', async () => {
      const manager = new SessionManager(sessionConfig)

      const fileName = 'test-session_rule-advisor.json'
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      const threeDaysAgo = new Date()
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
      await fs.utimes(filePath, threeDaysAgo, threeDaysAgo)

      await manager.cleanupOldSessions()

      const files = await fs.readdir(testSessionDir)
      expect(files).toContain(fileName)
    })

    it('should not throw error when cleanup fails', async () => {
      const manager = new SessionManager(sessionConfig)

      const fileName = 'test-session_rule-advisor.json'
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)

      await fs.chmod(filePath, 0o444)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      consoleErrorSpy.mockRestore()

      try {
        await fs.chmod(filePath, 0o644)
      } catch {}
    })

    it('should delete multiple old files in a single cleanup', async () => {
      const manager = new SessionManager(sessionConfig)

      const oldFile1 = 'old-session-1_rule-advisor.json'
      const oldFile2 = 'old-session-2_rule-advisor.json'
      const oldFilePath1 = path.join(testSessionDir, oldFile1)
      const oldFilePath2 = path.join(testSessionDir, oldFile2)
      await fs.writeFile(oldFilePath1, JSON.stringify({ test: 'data' }), 'utf-8')
      await fs.writeFile(oldFilePath2, JSON.stringify({ test: 'data' }), 'utf-8')

      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(oldFilePath1, eightDaysAgo, eightDaysAgo)
      await fs.utimes(oldFilePath2, eightDaysAgo, eightDaysAgo)

      await manager.cleanupOldSessions()

      const remainingFiles = await fs.readdir(testSessionDir)
      expect(remainingFiles).not.toContain(oldFile1)
      expect(remainingFiles).not.toContain(oldFile2)
    })
  })
})
