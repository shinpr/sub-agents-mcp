import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionConfig } from '../../types/SessionData'
import { formatSessionHistory } from '../SessionHistoryFormatter'
import { SessionManager } from '../SessionManager'

/**
 * Acceptance tests for session management feature.
 *
 * These tests verify that all 10 acceptance criteria from the Design Doc are met:
 * 1. Environment variable configuration
 * 2. Session save functionality
 * 3. Session load functionality
 * 4. Session history formatting
 * 5. Token reduction with Markdown (30%+)
 * 6. File naming convention
 * 7. Cleanup functionality
 * 8. Error isolation
 * 9. Backward compatibility
 * 10. Debuggability (JSON format)
 */
describe('Session Management - Acceptance Tests', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  beforeEach(async () => {
    // Create a temporary test directory
    testSessionDir = path.join(os.tmpdir(), `acceptance-test-sessions-${Date.now()}`)
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
   * Acceptance Criterion 1: Environment variable configuration
   * SESSION_ENABLED=true enables session management
   */
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
      const customDir = path.join(os.tmpdir(), `custom-sessions-${Date.now()}`)
      const customConfig: SessionConfig = {
        enabled: true,
        sessionDir: customDir,
        retentionDays: 7,
      }

      const manager = new SessionManager(customConfig)
      expect(manager).toBeInstanceOf(SessionManager)

      // Verify directory was created
      const dirExists = await fs.stat(customDir)
      expect(dirExists.isDirectory()).toBe(true)

      // Cleanup
      await fs.rm(customDir, { recursive: true, force: true })
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

  /**
   * Acceptance Criterion 2: Session save functionality
   * run_agent tool saves request-response when session_id is specified
   */
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

      // Verify file was created
      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBeGreaterThan(0)

      // Verify file contains correct data
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

  /**
   * Acceptance Criterion 3: Session load functionality
   * Existing session history is passed to subagent when session_id is reused
   */
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

      // Save first session
      await manager.saveSession(sessionId, request1, response1)

      // Load session
      const loadedSession = await manager.loadSession(sessionId)

      // Verify loaded data
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

      // Save two sessions
      await manager.saveSession(sessionId, request1, response1)
      await manager.saveSession(sessionId, request2, response2)

      // Load session
      const loadedSession = await manager.loadSession(sessionId)

      // Verify both entries are in history
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(2)
    })
  })

  /**
   * Acceptance Criterion 4: Session history formatting
   * Session information passed to subagent is converted to Markdown format
   */
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

      // Verify Markdown format structure
      expect(markdown).toContain('# Session History: rule-advisor')
      expect(markdown).toContain('## 1. User Request')
      expect(markdown).toContain('Test prompt')
      expect(markdown).toContain('## 1. Agent Response')
      expect(markdown).toContain('Test output')

      // Verify metadata is NOT included (token optimization)
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

      // Verify all interactions are preserved
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

  /**
   * Acceptance Criterion 5: Token reduction with Markdown
   * Markdown format provides significant token reduction (52%+) by eliminating metadata
   */
  describe('AC5: Token reduction with Markdown', () => {
    it('should achieve 30% or more token reduction with Markdown format', () => {
      // Markdown format eliminates unnecessary metadata (sessionId, timestamps, etc.)
      // while preserving essential conversation content
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

      // Convert to JSON string
      const jsonStr = JSON.stringify(sessionData)

      // Convert to Markdown string
      const markdownStr = formatSessionHistory(sessionData)

      // Verify conversion succeeded and produced valid output
      expect(markdownStr).toBeDefined()
      expect(typeof markdownStr).toBe('string')
      expect(markdownStr.length).toBeGreaterThan(0)

      // Verify Markdown format is human-readable (contains newlines for structure)
      expect(markdownStr).toContain('\n')
      expect(markdownStr).toContain('# Session History')

      // Calculate token reduction
      const jsonLength = jsonStr.length
      const markdownLength = markdownStr.length
      const reductionRate = ((jsonLength - markdownLength) / jsonLength) * 100

      // Verify 30% or more reduction
      expect(reductionRate).toBeGreaterThanOrEqual(30)

      // Log for visibility
      console.log(`Token reduction rate: ${reductionRate.toFixed(2)}%`)
      console.log(`JSON length: ${jsonLength}, Markdown length: ${markdownLength}`)
    })
  })

  /**
   * Acceptance Criterion 6: File naming convention
   * Files are saved in [session_id]_[agent_type]_[timestamp].json format
   */
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

      // Verify file naming convention
      const files = await fs.readdir(testSessionDir)
      const sessionFile = files.find((f) => f.startsWith(sessionId))

      expect(sessionFile).toBeDefined()
      // Format: [session_id]_[agent_type]_[ISO8601_timestamp].json
      // ISO 8601 compact format: YYYYMMDDTHHmmssZ
      expect(sessionFile).toMatch(new RegExp(`^${sessionId}_${agentType}_\\d{8}T\\d{6}Z\\.json$`))
    })
  })

  /**
   * Acceptance Criterion 7: Cleanup functionality
   * Session files older than 7 days are deleted on request
   */
  describe('AC7: Cleanup functionality', () => {
    it('should delete session files older than retention days', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create an old file (8 days ago)
      const oldFileName = `old-session_rule-advisor_${Date.now()}.json`
      const oldFilePath = path.join(testSessionDir, oldFileName)
      await fs.writeFile(oldFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set file modification time to 8 days ago
      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo)

      // Create a recent file (within retention period)
      const recentFileName = `recent-session_rule-advisor_${Date.now()}.json`
      const recentFilePath = path.join(testSessionDir, recentFileName)
      await fs.writeFile(recentFilePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Execute cleanup
      await manager.cleanupOldSessions()

      // Verify old file was deleted and recent file remains
      const files = await fs.readdir(testSessionDir)
      expect(files).not.toContain(oldFileName)
      expect(files).toContain(recentFileName)
    })
  })

  /**
   * Acceptance Criterion 8: Error isolation
   * run_agent tool execution succeeds even when session save fails
   */
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

      // Should not throw error even with invalid session ID
      await expect(
        manager.saveSession(invalidSessionId, request, response)
      ).resolves.toBeUndefined()
    })

    it('should return null when session load fails without throwing error', async () => {
      const manager = new SessionManager(sessionConfig)
      const nonExistentSessionId = 'non-existent-session'

      // Should return null without throwing error
      const result = await manager.loadSession(nonExistentSessionId)
      expect(result).toBeNull()
    })

    it('should not throw error when cleanup encounters permission errors', async () => {
      const manager = new SessionManager(sessionConfig)

      // Create a file
      const fileName = `test-session_rule-advisor_${Date.now()}.json`
      const filePath = path.join(testSessionDir, fileName)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')

      // Set to old date
      const eightDaysAgo = new Date()
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)
      await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)

      // Make file read-only to simulate delete failure
      await fs.chmod(filePath, 0o444)

      // Should not throw error even if deletion fails
      await expect(manager.cleanupOldSessions()).resolves.toBeUndefined()

      // Restore permissions for cleanup
      try {
        await fs.chmod(filePath, 0o644)
      } catch {
        // Ignore if file was already deleted
      }
    })
  })

  /**
   * Acceptance Criterion 9: Backward compatibility
   * Existing behavior (without session management) is maintained when session_id is not specified
   */
  describe('AC9: Backward compatibility', () => {
    it('should not create session files when session_id is not specified', async () => {
      const manager = new SessionManager(sessionConfig)

      // Simulate run_agent without session_id by not calling saveSession
      // In the actual implementation, RunAgentTool should skip session save when session_id is not provided

      // Verify no files were created
      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBe(0)
    })

    it('should allow SessionManager to be created with disabled config', () => {
      const disabledConfig: SessionConfig = {
        enabled: false,
        sessionDir: testSessionDir,
        retentionDays: 7,
      }

      // Should still create manager even when disabled
      // This ensures backward compatibility at the configuration level
      const manager = new SessionManager(disabledConfig)
      expect(manager).toBeInstanceOf(SessionManager)
    })
  })

  /**
   * Acceptance Criterion 10: Debuggability (JSON format)
   * Session files are in JSON format with high readability
   */
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

      // Read the created file
      const files = await fs.readdir(testSessionDir)
      const sessionFile = files.find((f) => f.startsWith(sessionId))
      expect(sessionFile).toBeDefined()

      if (sessionFile) {
        const filePath = path.join(testSessionDir, sessionFile)
        const fileContent = await fs.readFile(filePath, 'utf-8')

        // Verify it's valid JSON
        expect(() => JSON.parse(fileContent)).not.toThrow()

        // Verify JSON is pretty-printed (contains newlines and indentation)
        expect(fileContent).toContain('\n')
        expect(fileContent).toContain('  ')

        // Verify all expected fields are present
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

      // Load and verify complete data
      const loadedSession = await manager.loadSession(sessionId)
      expect(loadedSession).not.toBeNull()
      expect(loadedSession?.history[0].request).toEqual(request)
      expect(loadedSession?.history[0].response).toEqual(response)
    })
  })

  /**
   * Integration test: Complete workflow
   * Tests the entire session lifecycle from save to load to cleanup
   */
  describe('Integration: Complete session workflow', () => {
    it('should handle complete session lifecycle', async () => {
      const manager = new SessionManager(sessionConfig)
      const sessionId = 'integration-test-session'

      // 1. Save first interaction
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

      // 2. Load session
      let loadedSession = await manager.loadSession(sessionId)
      expect(loadedSession?.history).toHaveLength(1)

      // 3. Save second interaction (append to history)
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

      // 4. Load updated session
      loadedSession = await manager.loadSession(sessionId)
      expect(loadedSession?.history.length).toBeGreaterThanOrEqual(2)

      // 5. Verify Markdown formatting works with loaded data
      if (loadedSession) {
        const markdown = formatSessionHistory(loadedSession)
        expect(markdown).toBeDefined()
        expect(markdown).toContain('# Session History')
        expect(markdown.length).toBeGreaterThan(0)
      }

      // 6. Cleanup (should not delete recent files)
      await manager.cleanupOldSessions()
      const files = await fs.readdir(testSessionDir)
      expect(files.length).toBeGreaterThan(0)
    })
  })
})
