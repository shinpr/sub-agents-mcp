import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerConfig } from '../../config/ServerConfig.js'

describe('ServerConfig', () => {
  let testAgentsDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('AGENT_TYPE', 'cursor')

    testAgentsDir = path.join(tmpdir(), `test-agents-${Date.now()}`)
    fs.mkdirSync(testAgentsDir, { recursive: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    try {
      fs.rmSync(testAgentsDir, { recursive: true, force: true })
    } catch {}
  })

  it('should load environment variables: SERVER_NAME, AGENTS_DIR, AGENT_TYPE', () => {
    vi.stubEnv('SERVER_NAME', 'test-server')
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', 'claude')

    const config = new ServerConfig()

    expect(config.serverName).toBe('test-server')
    expect(config.agentsDir).toBe(testAgentsDir)
    expect(config.agentType).toBe('claude')
  })

  it.each([
    'cursor',
    'claude',
    'gemini',
    'codex',
    'glm',
    'kimi',
    'grok',
    'antigravity',
    'opencode',
    'command-code',
  ] as const)('should accept AGENT_TYPE=%s', (agentType) => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', agentType)

    const config = new ServerConfig()

    expect(config.agentType).toBe(agentType)
  })

  it('should load CLI_API_KEY as glmApiKey when set', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_API_KEY', 'zai-secret')

    const config = new ServerConfig()

    expect(config.glmApiKey).toBe('zai-secret')
  })

  it('should treat blank CLI_API_KEY as missing for glmApiKey', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_API_KEY', '   ')

    const config = new ServerConfig()

    expect(config.glmApiKey).toBeUndefined()
  })

  it('should load CLI_API_KEY as kimiApiKey when set', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_API_KEY', 'kimi-secret')

    const config = new ServerConfig()

    expect(config.kimiApiKey).toBe('kimi-secret')
  })

  it('should treat blank CLI_API_KEY as missing for kimiApiKey', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CLI_API_KEY', '   ')

    const config = new ServerConfig()

    expect(config.kimiApiKey).toBeUndefined()
  })

  it('should treat blank CURSOR_API_KEY as missing for cursorApiKey', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CURSOR_API_KEY', '   ')

    const config = new ServerConfig()

    expect(config.cursorApiKey).toBeUndefined()
  })

  it('should treat blank CLI_API_KEY fallback as missing for cursorApiKey', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CURSOR_API_KEY', undefined)
    vi.stubEnv('CLI_API_KEY', '   ')

    const config = new ServerConfig()

    expect(config.cursorApiKey).toBeUndefined()
  })

  it('should throw error when AGENT_TYPE is an unsupported value', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', 'malicious-agent')

    expect(() => new ServerConfig()).toThrow(/Invalid AGENT_TYPE/)
  })

  it('should throw a corrective error when AGENT_TYPE is not set', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', undefined)

    expect(() => new ServerConfig()).toThrow('AGENT_TYPE environment variable is required')
    expect(() => new ServerConfig()).toThrow(/cursor, claude, gemini, codex/)
  })

  it('should throw a corrective error when AGENT_TYPE is blank', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', '   ')

    expect(() => new ServerConfig()).toThrow('AGENT_TYPE environment variable is required')
  })

  it.each(['read-only', 'safe-edit', 'yolo'] as const)(
    'should accept AGENT_PERMISSION=%s',
    (permission) => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENT_PERMISSION', permission)

      const config = new ServerConfig()

      expect(config.agentPermission).toBe(permission)
    }
  )

  it('should default AGENT_PERMISSION to safe-edit when not set', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_PERMISSION', undefined)

    const config = new ServerConfig()

    expect(config.agentPermission).toBe('safe-edit')
  })

  it('should default AGENT_PERMISSION to safe-edit when empty string', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_PERMISSION', '')

    const config = new ServerConfig()

    expect(config.agentPermission).toBe('safe-edit')
  })

  it('should throw error when AGENT_PERMISSION is an unsupported value', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_PERMISSION', 'godmode')

    expect(() => new ServerConfig()).toThrow(/Invalid AGENT_PERMISSION/)
  })

  describe('model and effort configuration', () => {
    it('should load global AGENT_MODEL and AGENT_EFFORT values', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENT_TYPE', 'codex')
      vi.stubEnv('AGENT_MODEL', 'gpt-5.6-luna')
      vi.stubEnv('AGENT_EFFORT', 'high')

      const config = new ServerConfig()

      expect(config.agentModel).toBe('gpt-5.6-luna')
      expect(config.agentEffort).toBe('high')
    })

    it('should accept AGENT_EFFORT for Antigravity', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENT_TYPE', 'antigravity')
      vi.stubEnv('AGENT_EFFORT', 'high')

      const config = new ServerConfig()

      expect(config.agentEffort).toBe('high')
    })

    it('should treat blank model and effort values as unset', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENT_MODEL', '   ')
      vi.stubEnv('AGENT_EFFORT', '')

      const config = new ServerConfig()

      expect(config.agentModel).toBeUndefined()
      expect(config.agentEffort).toBeUndefined()
    })

    it.each(['cursor', 'gemini'] as const)(
      'should reject AGENT_EFFORT for AGENT_TYPE=%s',
      (agentType) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('AGENT_TYPE', agentType)
        vi.stubEnv('AGENT_EFFORT', 'high')

        expect(() => new ServerConfig()).toThrow(/AGENT_EFFORT is not supported/)
      }
    )
  })

  it('should throw error when LOG_LEVEL is an unsupported value', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('LOG_LEVEL', 'verbose')

    expect(() => new ServerConfig()).toThrow(/Invalid LOG_LEVEL/)
  })

  it('should throw error when AGENTS_DIR is not set', () => {
    vi.stubEnv('AGENTS_DIR', undefined)

    expect(() => new ServerConfig()).toThrow('AGENTS_DIR environment variable is required')
    expect(() => new ServerConfig()).toThrow('Please set it to an absolute path')
  })

  it('should use default values for optional configs', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('SERVER_NAME', undefined)

    const config = new ServerConfig()

    expect(config.serverName).toBe('sub-agents-mcp')
    expect(config.agentsDir).toBe(testAgentsDir)
    expect(config.executionTimeoutMs).toBe(300000)
  })

  it('should throw error when AGENTS_DIR is empty string', () => {
    vi.stubEnv('AGENTS_DIR', '')

    expect(() => new ServerConfig()).toThrow('AGENTS_DIR environment variable is required')
  })

  it('should handle empty optional environment variables gracefully', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('SERVER_NAME', '')

    const config = new ServerConfig()

    expect(config.serverName).toBe('sub-agents-mcp')
  })

  describe('session management configuration', () => {
    it('should load SESSION_ENABLED as true when set to "true"', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('SESSION_ENABLED', 'true')

      const config = new ServerConfig()

      expect(config.sessionEnabled).toBe(true)
    })

    it('should default SESSION_ENABLED to false when not set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('SESSION_ENABLED', undefined)

      const config = new ServerConfig()

      expect(config.sessionEnabled).toBe(false)
    })

    it('should treat SESSION_ENABLED as false for non-"true" values', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      const falseValues = ['false', '1', 'yes', 'TRUE', '']

      for (const value of falseValues) {
        vi.stubEnv('SESSION_ENABLED', value)

        const config = new ServerConfig()

        expect(config.sessionEnabled).toBe(false)
      }
    })

    it('should load SESSION_DIR when set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('SESSION_DIR', '/custom/session/path')

      const config = new ServerConfig()

      expect(config.sessionDir).toBe('/custom/session/path')
    })

    it('should default SESSION_DIR to ".mcp-sessions" when not set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('SESSION_DIR', undefined)

      const config = new ServerConfig()

      expect(config.sessionDir).toBe('.mcp-sessions')
    })

    it('should load SESSION_RETENTION_DAYS when set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('SESSION_RETENTION_DAYS', '14')

      const config = new ServerConfig()

      expect(config.sessionRetentionDays).toBe(14)
    })

    it('should default SESSION_RETENTION_DAYS to 1 when not set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('SESSION_RETENTION_DAYS', undefined)

      const config = new ServerConfig()

      expect(config.sessionRetentionDays).toBe(1)
    })

    it('should use default SESSION_RETENTION_DAYS for invalid values', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)

      const invalidValues = ['invalid', 'not-a-number', '', '-5', '0']

      for (const invalidValue of invalidValues) {
        vi.stubEnv('SESSION_RETENTION_DAYS', invalidValue)

        const config = new ServerConfig()

        expect(config.sessionRetentionDays).toBe(1)
      }
    })
  })

  describe('AGENTS_SETTINGS_PATH configuration', () => {
    it('should load AGENTS_SETTINGS_PATH when set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENTS_SETTINGS_PATH', '/custom/settings/path')

      const config = new ServerConfig()

      expect(config.agentsSettingsPath).toBe('/custom/settings/path')
    })

    it('should return undefined when AGENTS_SETTINGS_PATH is not set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENTS_SETTINGS_PATH', undefined)

      const config = new ServerConfig()

      expect(config.agentsSettingsPath).toBeUndefined()
    })

    it('should return undefined when AGENTS_SETTINGS_PATH is empty string', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENTS_SETTINGS_PATH', '')

      const config = new ServerConfig()

      expect(config.agentsSettingsPath).toBeUndefined()
    })
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
