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

  it('should load environment variables: SERVER_NAME, AGENTS_DIR, CLI_COMMAND', () => {
    // Mock environment variables
    vi.stubEnv('SERVER_NAME', 'test-server')
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_COMMAND', 'test-cli')

    // This test will fail until we implement the ServerConfig class
    const config = new ServerConfig()

    expect(config.serverName).toBe('test-server')
    expect(config.agentsDir).toBe(testAgentsDir)
    expect(config.cliCommand).toBe('test-cli')
  })

  it('should use default values when environment variables are not set', () => {
    // Ensure environment variables are not set
    vi.stubEnv('SERVER_NAME', undefined)
    vi.stubEnv('AGENTS_DIR', undefined)
    vi.stubEnv('CLI_COMMAND', undefined)

    const config = new ServerConfig()

    expect(config.serverName).toBe('sub-agents-mcp-server')
    expect(config.agentsDir).toBe('./agents')
    expect(config.cliCommand).toBe('claude-code')
    expect(config.executionTimeoutMs).toBe(180000)
  })

  it('should validate required environment variables', () => {
    // Mock missing required environment variable
    vi.stubEnv('SERVER_NAME', '')
    vi.stubEnv('AGENTS_DIR', '/test/agents')
    vi.stubEnv('CLI_COMMAND', 'test-cli')

    expect(() => {
      new ServerConfig()
    }).toThrow('Configuration validation failed: SERVER_NAME cannot be empty')
  })

  it('should validate directory paths exist and are readable', () => {
    const nonExistentDir = path.join(tmpdir(), `nonexistent-${Date.now()}`)

    vi.stubEnv('SERVER_NAME', 'test-server')
    vi.stubEnv('AGENTS_DIR', nonExistentDir)
    vi.stubEnv('CLI_COMMAND', 'test-cli')

    expect(() => {
      new ServerConfig()
    }).toThrow('Configuration validation failed: AGENTS_DIR does not exist or is not readable')
  })

  describe('execution timeout validation', () => {
    it('should use default timeout when EXECUTION_TIMEOUT_MS is not set', () => {
      vi.stubEnv('EXECUTION_TIMEOUT_MS', undefined)
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      const config = new ServerConfig()

      expect(config.executionTimeoutMs).toBe(180000) // 3 minutes default
    })

    it('should use valid timeout from environment variable', () => {
      vi.stubEnv('EXECUTION_TIMEOUT_MS', '120000') // 2 minutes
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      const config = new ServerConfig()

      expect(config.executionTimeoutMs).toBe(120000)
    })

    it('should use default timeout for invalid values', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      // Test invalid values
      const invalidValues = ['invalid', '500', '400000', '-1000'] // too low, too high, negative

      for (const invalidValue of invalidValues) {
        vi.stubEnv('EXECUTION_TIMEOUT_MS', invalidValue)

        const config = new ServerConfig()

        expect(config.executionTimeoutMs).toBe(180000) // Should use default
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Invalid EXECUTION_TIMEOUT_MS value: ${invalidValue}`)
        )
      }

      consoleSpy.mockRestore()
    })

    it('should accept timeout values within valid range', () => {
      const validValues = [
        { input: '1000', expected: 1000 }, // minimum
        { input: '60000', expected: 60000 }, // 1 minute
        { input: '300000', expected: 300000 }, // maximum (5 minutes)
      ]
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      for (const { input, expected } of validValues) {
        vi.stubEnv('EXECUTION_TIMEOUT_MS', input)

        const config = new ServerConfig()

        expect(config.executionTimeoutMs).toBe(expected)
      }
    })
  })

  it('should provide configuration as readonly object', () => {
    vi.stubEnv('SERVER_NAME', 'test-server')
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_COMMAND', 'test-cli')
    vi.stubEnv('EXECUTION_TIMEOUT_MS', '180000')

    const config = new ServerConfig()
    const configObject = config.toObject()

    expect(configObject).toEqual({
      serverName: 'test-server',
      serverVersion: '1.0.0',
      agentsDir: testAgentsDir,
      cliCommand: 'test-cli',
      maxOutputSize: 1048576,
      enableCache: true,
      logLevel: 'info',
      executionTimeoutMs: 180000,
    })

    // Verify it's readonly (modification should throw error)
    expect(() => {
      ;(configObject as any).serverName = 'modified'
    }).toThrow()
    expect(config.serverName).toBe('test-server')
  })
})
