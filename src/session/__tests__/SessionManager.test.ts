import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
