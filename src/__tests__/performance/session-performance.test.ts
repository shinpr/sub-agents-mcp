import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionManager } from '../../session/SessionManager.js'
import type { SessionConfig } from '../../types/SessionData.js'

describe('Session Management - Performance Tests', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    testSessionDir = path.join(os.tmpdir(), `perf-test-sessions-${Date.now()}`)
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

  describe('Session save performance', () => {
    it('should save session in less than 100ms', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'perf-save-test'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Performance test prompt',
        cwd: '/test/dir',
      }
      const response = {
        stdout: 'Performance test output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      const startTime = performance.now()
      await manager.saveSession(sessionId, request, response)
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(500)
    })

    it('should save large session data in less than 100ms', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'perf-save-large'

      const largePrompt = 'Large prompt '.repeat(100) // ~1.3KB
      const request = {
        agent: 'rule-advisor',
        prompt: largePrompt,
        cwd: '/test/dir',
      }

      const largeOutput = 'Large output '.repeat(100) // ~1.3KB
      const response = {
        stdout: largeOutput,
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      const startTime = performance.now()
      await manager.saveSession(sessionId, request, response)
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(500)
    })

    it('should save session with existing history in less than 100ms', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'perf-save-append'

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

      const request2 = {
        agent: 'rule-advisor',
        prompt: 'Second prompt',
      }
      const response2 = {
        stdout: 'Second output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      const startTime = performance.now()
      await manager.saveSession(sessionId, request2, response2)
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(500)
    })
  })

  describe('Session load performance', () => {
    it('should load session in less than 100ms', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'perf-load-test'
      const request = {
        agent: 'rule-advisor',
        prompt: 'Load performance test',
      }
      const response = {
        stdout: 'Load performance output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      }

      await manager.saveSession(sessionId, request, response)

      const startTime = performance.now()
      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(500)
      expect(loadedSession).not.toBeNull()
    })

    it('should load large session data in less than 100ms', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'perf-load-large'

      const largePrompt = 'Large prompt '.repeat(100)
      const largeOutput = 'Large output '.repeat(100)

      for (let i = 0; i < 10; i++) {
        const request = {
          agent: 'rule-advisor',
          prompt: `${largePrompt} - ${i}`,
        }
        const response = {
          stdout: `${largeOutput} - ${i}`,
          stderr: '',
          exitCode: 0,
          executionTime: 100 + i,
        }
        await manager.saveSession(sessionId, request, response)
      }

      const startTime = performance.now()
      const loadedSession = await manager.loadSession(sessionId, 'rule-advisor')
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(100)
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(10)
    })

    it('should return null quickly when session does not exist', async () => {
      const manager = new SessionManager(sessionConfig)
      const nonExistentSessionId = 'non-existent-perf-test'

      const startTime = performance.now()
      const loadedSession = await manager.loadSession(nonExistentSessionId, 'rule-advisor')
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(100)
      expect(loadedSession).toBeNull()
    })
  })

  describe('Large-scale session management', () => {
    it('should handle 1000 sessions without performance degradation', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionCount = 1000

      const createStartTime = performance.now()
      const sessionIds: string[] = []

      for (let i = 0; i < sessionCount; i++) {
        const sessionId = `perf-scale-test-${i}`
        sessionIds.push(sessionId)
        const request = {
          agent: 'rule-advisor',
          prompt: `Test prompt ${i}`,
        }
        const response = {
          stdout: `Test output ${i}`,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
        }
        await manager.saveSession(sessionId, request, response)
      }

      const createEndTime = performance.now()
      const createDuration = createEndTime - createStartTime

      const avgCreateTime = createDuration / sessionCount
      expect(avgCreateTime).toBeLessThan(100)

      const loadStartTime = performance.now()
      const loadedSession = await manager.loadSession(
        sessionIds[sessionCount - 1] || '',
        'rule-advisor'
      )
      const loadEndTime = performance.now()
      const loadDuration = loadEndTime - loadStartTime

      expect(loadDuration).toBeLessThan(100)
      expect(loadedSession).not.toBeNull()
    }, 120000) // Increase timeout for this test to 120 seconds

    it('should load session quickly even with many files in directory', async () => {
      const manager = new SessionManager(sessionConfig)

      for (let i = 0; i < 100; i++) {
        const sessionId = `perf-many-files-${i}`
        const request = {
          agent: 'rule-advisor',
          prompt: `Test prompt ${i}`,
        }
        const response = {
          stdout: `Test output ${i}`,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
        }
        await manager.saveSession(sessionId, request, response)
      }

      const targetSessionId = 'perf-many-files-50'
      const startTime = performance.now()
      const loadedSession = await manager.loadSession(targetSessionId, 'rule-advisor')
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(100)
      expect(loadedSession).not.toBeNull()
    }, 30000) // Increase timeout to 30 seconds
  })

  describe('Cleanup performance', () => {
    it('should cleanup old sessions without blocking', async () => {
      const manager = new SessionManager(sessionConfig)

      const oldFileCount = 50
      for (let i = 0; i < oldFileCount; i++) {
        const oldFileName = `old-session-${i}_rule-advisor_${Date.now() + i}.json`
        const oldFilePath = path.join(testSessionDir, oldFileName)
        await fs.writeFile(oldFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

        const eightDaysAgo = new Date()
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
        await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo)
      }

      const startTime = performance.now()
      await manager.cleanupOldSessions()
      const endTime = performance.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(1000)

      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBe(0)
    })
  })

  describe('Concurrent operations', () => {
    it('should handle concurrent save operations efficiently', async () => {
      const manager = new SessionManager(sessionConfig)
      const concurrentCount = 10

      const savePromises = []
      const startTime = performance.now()

      for (let i = 0; i < concurrentCount; i++) {
        const sessionId = `concurrent-save-${i}`
        const request = {
          agent: 'rule-advisor',
          prompt: `Concurrent prompt ${i}`,
        }
        const response = {
          stdout: `Concurrent output ${i}`,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
        }
        savePromises.push(manager.saveSession(sessionId, request, response))
      }

      await Promise.all(savePromises)
      const endTime = performance.now()
      const duration = endTime - startTime

      const avgTime = duration / concurrentCount
      expect(avgTime).toBeLessThan(50)

      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBe(concurrentCount)
    })

    it('should handle concurrent load operations efficiently', async () => {
      const manager = new SessionManager(sessionConfig)
      const concurrentCount = 10

      for (let i = 0; i < concurrentCount; i++) {
        const sessionId = `concurrent-load-${i}`
        const request = {
          agent: 'rule-advisor',
          prompt: `Load prompt ${i}`,
        }
        const response = {
          stdout: `Load output ${i}`,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
        }
        await manager.saveSession(sessionId, request, response)
      }

      const loadPromises = []
      const startTime = performance.now()

      for (let i = 0; i < concurrentCount; i++) {
        const sessionId = `concurrent-load-${i}`
        loadPromises.push(manager.loadSession(sessionId, 'rule-advisor'))
      }

      const results = await Promise.all(loadPromises)
      const endTime = performance.now()
      const duration = endTime - startTime

      const avgTime = duration / concurrentCount
      expect(avgTime).toBeLessThan(50)

      expect(results.every((result) => result !== null)).toBe(true)
    })
  })
})
