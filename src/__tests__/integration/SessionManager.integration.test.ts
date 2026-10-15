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
    testSessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-sessions-'))
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
    it('should create session directory if it does not exist', async () => {
      // Must not exist yet: a unique parent, with the target path still uncreated.
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'new-session-parent-'))
      const newDir = path.join(parent, 'sessions')
      const newConfig: SessionConfig = {
        enabled: true,
        sessionDir: newDir,
        retentionDays: 7,
      }

      new SessionManager(newConfig)

      const dirExists = await fs.stat(newDir)
      expect(dirExists.isDirectory()).toBe(true)

      await fs.rm(parent, { recursive: true, force: true })
    })
  })

  describe('validateSessionId', () => {
    it.each(['abc123', 'abc-123', 'abc_123', 'ABC-123_xyz'])(
      'should accept session ID %j',
      (sessionId) => {
        const manager = new SessionManager(sessionConfig)

        expect(() => manager.validateSessionId(sessionId)).not.toThrow()
      }
    )

    it.each([
      '../etc',
      './local',
      '../../etc',
      '../etc/passwd',
      'abc@123',
      'abc/123',
      'abc\\123',
      'abc 123',
      'abc;123',
      '',
    ])('should reject session ID %j, including when building a file path', (sessionId) => {
      const manager = new SessionManager(sessionConfig)

      expect(() => manager.validateSessionId(sessionId)).toThrow('Invalid session ID')
      expect(() => manager.buildFilePath(sessionId, 'rule-advisor')).toThrow('Invalid session ID')
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

      const withinRetentionFileName = 'within-retention_rule-advisor.json'
      const withinRetentionFilePath = path.join(testSessionDir, withinRetentionFileName)
      await fs.writeFile(withinRetentionFilePath, JSON.stringify({ test: 'data' }), 'utf-8')
      const threeDaysAgo = new Date()
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
      await fs.utimes(withinRetentionFilePath, threeDaysAgo, threeDaysAgo)

      await manager.cleanupOldSessions()

      const files = await fs.readdir(testSessionDir)
      expect(files).not.toContain(oldFileName)
      expect(files).toContain(recentFileName)
      expect(files).toContain(withinRetentionFileName)
    })

    it('should never log to stdout, which carries the MCP protocol stream', async () => {
      const manager = new SessionManager(sessionConfig)
      // console.log is the stdout path; vitest intercepts it, so the spy has to sit
      // on console itself rather than on process.stdout.write.
      const stdoutLog = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const oldFilePath = path.join(testSessionDir, 'stdout-probe_rule-advisor.json')
        await fs.writeFile(oldFilePath, JSON.stringify({ test: 'data' }), 'utf-8')
        const eightDaysAgo = new Date()
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
        await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo)

        await manager.cleanupOldSessions()

        // A successful deletion is the path that used to log to stdout.
        expect(await fs.readdir(testSessionDir)).not.toContain('stdout-probe_rule-advisor.json')
        expect(stdoutLog).not.toHaveBeenCalled()
      } finally {
        stdoutLog.mockRestore()
      }
    })
  })
})
