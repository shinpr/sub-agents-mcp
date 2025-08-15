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

  it('should provide configuration as readonly object', () => {
    vi.stubEnv('SERVER_NAME', 'test-server')
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_COMMAND', 'test-cli')

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
    })

    // Verify it's readonly (modification should throw error)
    expect(() => {
      ;(configObject as any).serverName = 'modified'
    }).toThrow()
    expect(config.serverName).toBe('test-server')
  })
})
