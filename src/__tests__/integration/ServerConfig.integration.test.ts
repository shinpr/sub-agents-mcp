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

    testAgentsDir = fs.mkdtempSync(path.join(tmpdir(), 'test-agents-'))
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

  it('should treat blank CLI_API_KEY as missing for glm, kimi and cursor keys', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CURSOR_API_KEY', undefined)
    vi.stubEnv('CLI_API_KEY', '   ')

    const config = new ServerConfig()

    expect(config.glmApiKey).toBeUndefined()
    expect(config.kimiApiKey).toBeUndefined()
    expect(config.cursorApiKey).toBeUndefined()
  })

  it('should not fall back to CLI_API_KEY when CURSOR_API_KEY is blank but present', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CURSOR_API_KEY', '   ')
    vi.stubEnv('CLI_API_KEY', 'cli-secret')

    const config = new ServerConfig()

    // A present-but-blank CURSOR_API_KEY wins the `||` and is then rejected as
    // blank, so the CLI_API_KEY fallback is deliberately never reached.
    expect(config.cursorApiKey).toBeUndefined()
    expect(config.glmApiKey).toBe('cli-secret')
    expect(config.kimiApiKey).toBe('cli-secret')
  })

  it('should preserve surrounding whitespace in the adopted API key values', () => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('CURSOR_API_KEY', '  cursor-secret  ')
    vi.stubEnv('CLI_API_KEY', '  cli-secret  ')

    const config = new ServerConfig()

    // trim() only decides whether a value counts as blank; the adopted value is
    // never rewritten.
    expect(config.cursorApiKey).toBe('  cursor-secret  ')
    expect(config.glmApiKey).toBe('  cli-secret  ')
    expect(config.kimiApiKey).toBe('  cli-secret  ')
  })

  it.each([
    ['AGENT_TYPE', 'malicious-agent', /Invalid AGENT_TYPE/],
    ['AGENT_PERMISSION', 'godmode', /Invalid AGENT_PERMISSION/],
    ['LOG_LEVEL', 'verbose', /Invalid LOG_LEVEL/],
  ])('should throw error when %s is the unsupported value %s', (name, value, error) => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv(name, value)

    expect(() => new ServerConfig()).toThrow(error)
  })

  it.each([undefined, '   '])(
    'should throw a corrective error when AGENT_TYPE is %j',
    (agentType) => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENT_TYPE', agentType)

      expect(() => new ServerConfig()).toThrow('AGENT_TYPE environment variable is required')
      expect(() => new ServerConfig()).toThrow(/cursor, claude, gemini, codex/)
    }
  )

  it.each(['read-only', 'safe-edit', 'yolo'] as const)(
    'should accept AGENT_PERMISSION=%s',
    (permission) => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENT_PERMISSION', permission)

      const config = new ServerConfig()

      expect(config.agentPermission).toBe(permission)
    }
  )

  it.each([undefined, ''])('should default AGENT_PERMISSION to safe-edit when %j', (permission) => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_PERMISSION', permission)

    const config = new ServerConfig()

    expect(config.agentPermission).toBe('safe-edit')
  })

  describe('model and effort configuration', () => {
    it.each(['codex', 'antigravity'] as const)(
      'should load AGENT_MODEL and AGENT_EFFORT for AGENT_TYPE=%s',
      (agentType) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('AGENT_TYPE', agentType)
        vi.stubEnv('AGENT_MODEL', 'gpt-5.6-luna')
        vi.stubEnv('AGENT_EFFORT', 'high')

        const config = new ServerConfig()

        expect(config.agentModel).toBe('gpt-5.6-luna')
        expect(config.agentEffort).toBe('high')
      }
    )

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

  it.each([undefined, ''])('should throw error when AGENTS_DIR is %j', (agentsDir) => {
    vi.stubEnv('AGENTS_DIR', agentsDir)

    expect(() => new ServerConfig()).toThrow('AGENTS_DIR environment variable is required')
    expect(() => new ServerConfig()).toThrow('Please set it to an absolute path')
  })

  it.each([undefined, ''])('should default SERVER_NAME to sub-agents-mcp when %j', (serverName) => {
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('SERVER_NAME', serverName)

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

    it.each([undefined, 'false', '1', 'yes', 'TRUE', ''])(
      'should treat SESSION_ENABLED=%j as false',
      (value) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('SESSION_ENABLED', value)

        const config = new ServerConfig()

        expect(config.sessionEnabled).toBe(false)
      }
    )

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

    it.each(['invalid', 'not-a-number', '', '-5', '0'])(
      'should use default SESSION_RETENTION_DAYS for invalid value %j',
      (invalidValue) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('SESSION_RETENTION_DAYS', invalidValue)

        const config = new ServerConfig()

        expect(config.sessionRetentionDays).toBe(1)
      }
    )
  })

  describe('AGENTS_SETTINGS_PATH configuration', () => {
    it('should load AGENTS_SETTINGS_PATH when set', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('AGENTS_SETTINGS_PATH', '/custom/settings/path')

      const config = new ServerConfig()

      expect(config.agentsSettingsPath).toBe('/custom/settings/path')
    })

    it.each([undefined, ''])(
      'should return undefined when AGENTS_SETTINGS_PATH is %j',
      (settingsPath) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('AGENTS_SETTINGS_PATH', settingsPath)

        const config = new ServerConfig()

        expect(config.agentsSettingsPath).toBeUndefined()
      }
    )
  })

  describe('execution timeout validation', () => {
    it.each([
      ['1000', 1000],
      ['60000', 60000],
      ['120000', 120000],
      ['600000', 600000],
    ])('should accept EXECUTION_TIMEOUT_MS=%s', (input, expected) => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('EXECUTION_TIMEOUT_MS', input)

      const config = new ServerConfig()

      expect(config.executionTimeoutMs).toBe(expected)
    })

    it.each([undefined, '', '   '])(
      'should use the default timeout when EXECUTION_TIMEOUT_MS is %s',
      (unset) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('EXECUTION_TIMEOUT_MS', unset)

        expect(new ServerConfig().executionTimeoutMs).toBe(300000)
      }
    )

    it.each(['invalid', 'not-a-number', '5min', '0', '-1', '3.9', '1e6', '0x10'])(
      'should reject %s rather than silently mis-reading it as a millisecond value',
      (invalidValue) => {
        vi.stubEnv('AGENTS_DIR', testAgentsDir)
        vi.stubEnv('EXECUTION_TIMEOUT_MS', invalidValue)

        // Partial parsing used to turn these into a few milliseconds, so every
        // execution timed out instantly with nothing pointing at the setting.
        expect(() => new ServerConfig()).toThrow(/EXECUTION_TIMEOUT_MS/)
      }
    )

    it('should name the variable, the value and the fix in the failure message', () => {
      vi.stubEnv('AGENTS_DIR', testAgentsDir)
      vi.stubEnv('EXECUTION_TIMEOUT_MS', '5min')

      expect(() => new ServerConfig()).toThrow(
        /Invalid EXECUTION_TIMEOUT_MS: "5min".*positive whole number of milliseconds.*300000/s
      )
    })
  })
})
