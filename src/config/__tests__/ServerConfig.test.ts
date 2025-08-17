import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ServerConfig } from 'src/config/ServerConfig'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('ServerConfig', () => {
  let testAgentsDir: string

  beforeEach(() => {
    // Reset environment variables before each test
    vi.restoreAllMocks()

    // Create a temporary test directory that exists
    testAgentsDir = path.join(tmpdir(), `test-agents-${Date.now()}`)
    fs.mkdirSync(testAgentsDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testAgentsDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should load environment variables: SERVER_NAME, AGENTS_DIR, AGENT_TYPE', () => {
    // Mock environment variables
    vi.stubEnv('SERVER_NAME', 'test-server')
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', 'claude')

    // This test will fail until we implement the ServerConfig class
    const config = new ServerConfig()

    expect(config.serverName).toBe('test-server')
    expect(config.agentsDir).toBe(testAgentsDir)
    expect(config.agentType).toBe('claude')
  })

  it('should throw error when AGENTS_DIR is not set', () => {
    // Ensure AGENTS_DIR is not set
    vi.stubEnv('AGENTS_DIR', undefined)

    expect(() => new ServerConfig()).toThrow('AGENTS_DIR environment variable is required')
    expect(() => new ServerConfig()).toThrow('Please set it to an absolute path')
  })

  it('should use default values for other configs when only AGENTS_DIR is set', () => {
    // Set only required AGENTS_DIR
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('SERVER_NAME', undefined)
    vi.stubEnv('AGENT_TYPE', undefined)

    const config = new ServerConfig()

    expect(config.serverName).toBe('sub-agents-mcp')
    expect(config.agentsDir).toBe(testAgentsDir)
    expect(config.agentType).toBe('cursor')
    expect(config.executionTimeoutMs).toBe(300000)
  })

  it('should throw error when AGENTS_DIR is empty string', () => {
    // Mock empty AGENTS_DIR
    vi.stubEnv('AGENTS_DIR', '')

    expect(() => new ServerConfig()).toThrow('AGENTS_DIR environment variable is required')
  })

  it('should handle empty optional environment variables gracefully', () => {
    // Set required AGENTS_DIR, but empty optional configs
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('SERVER_NAME', '')
    vi.stubEnv('AGENT_TYPE', '')

    const config = new ServerConfig()

    // Should fall back to defaults when empty
    expect(config.serverName).toBe('sub-agents-mcp')
    expect(config.agentType).toBe('cursor')
  })

  describe('execution timeout validation', () => {
    it('should use default timeout when EXECUTION_TIMEOUT_MS is not set', () => {
      vi.stubEnv('EXECUTION_TIMEOUT_MS', undefined)
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      const config = new ServerConfig()

      expect(config.executionTimeoutMs).toBe(300000) // 5 minutes default
    })

    it('should use valid timeout from environment variable', () => {
      vi.stubEnv('EXECUTION_TIMEOUT_MS', '120000') // 2 minutes
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      const config = new ServerConfig()

      expect(config.executionTimeoutMs).toBe(120000)
    })

    it('should use default timeout for invalid values', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      // Test invalid values (non-numeric will be parsed as NaN)
      const invalidValues = ['invalid', 'not-a-number', '']

      for (const invalidValue of invalidValues) {
        vi.stubEnv('EXECUTION_TIMEOUT_MS', invalidValue)

        const config = new ServerConfig()

        expect(config.executionTimeoutMs).toBe(300000) // Should use default
      }
    })

    it('should accept timeout values within valid range', () => {
      const validValues = [
        { input: '1000', expected: 1000 }, // minimum
        { input: '60000', expected: 60000 }, // 1 minute
        { input: '600000', expected: 600000 }, // maximum (10 minutes)
      ]
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      for (const { input, expected } of validValues) {
        vi.stubEnv('EXECUTION_TIMEOUT_MS', input)

        const config = new ServerConfig()

        expect(config.executionTimeoutMs).toBe(expected)
      }
    })
  })
})
