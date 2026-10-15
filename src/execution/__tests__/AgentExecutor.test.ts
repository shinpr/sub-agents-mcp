import type { SpawnOptions } from 'node:child_process'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { AgentExecutor, createExecutionConfig } from '../AgentExecutor.js'

type SpawnMockOptions = SpawnOptions & { env: NodeJS.ProcessEnv }

/** The subset of `ChildProcess` that {@link AgentExecutor} actually drives. */
interface MockChildProcess {
  stdin: { end: Mock }
  stdout: { on: Mock }
  stderr: { on: Mock }
  on: Mock
  kill: Mock
}

const mockSpawn = vi.hoisted(() =>
  vi.fn<(command: string, args: string[], options: SpawnMockOptions) => MockChildProcess>()
)

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

const mockIsOpenCodeV2 = vi.hoisted(() => vi.fn<() => Promise<boolean>>())

vi.mock('../OpenCodeVersion.js', () => ({
  isOpenCodeV2: mockIsOpenCodeV2,
}))

/** Arguments the executor passed to `spawn` on the given call. */
function spawnArgs(callIndex = 0): string[] {
  const call = mockSpawn.mock.calls[callIndex]
  if (!call) {
    throw new Error(`spawn was not called ${callIndex + 1} time(s)`)
  }
  return call[1]
}

function createMockProcess(options: {
  stdoutData?: string
  stdoutChunks?: Buffer[]
  stdoutDelay?: number
  stderrData?: string
  exitCode?: number
  closeDelay?: number
  noClose?: boolean
  triggerError?: Error
}): MockChildProcess {
  const {
    stdoutData,
    stdoutChunks,
    stdoutDelay = 10,
    stderrData,
    exitCode = 0,
    closeDelay = 50,
    noClose = false,
    triggerError,
  } = options

  let closeCallback: ((code: number | null, signal?: NodeJS.Signals | null) => void) | undefined

  return {
    stdin: { end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          const chunks = stdoutChunks ?? (stdoutData ? [Buffer.from(stdoutData)] : [])
          chunks.forEach((chunk, index) => {
            setTimeout(() => callback(chunk), stdoutDelay * (index + 1))
          })
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stderrData) {
          setTimeout(() => callback(Buffer.from(stderrData)), stdoutDelay)
        }
      }),
    },
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'close') {
        closeCallback = callback
        if (!noClose) {
          setTimeout(() => callback(exitCode), closeDelay)
        }
      }
      if (event === 'error' && triggerError) {
        setTimeout(() => callback(triggerError), stdoutDelay)
      }
    }),
    kill: vi.fn((signal?: NodeJS.Signals) => {
      if (noClose && signal === 'SIGKILL') {
        setTimeout(() => closeCallback?.(null, 'SIGKILL'), 0)
      }
      return true
    }),
  }
}

function createSuccessMock(data = 'Test execution successful'): MockChildProcess {
  return createMockProcess({
    stdoutData: `${JSON.stringify({ type: 'result', result: data })}\n`,
  })
}

describe('AgentExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockImplementation(() => createSuccessMock())
    mockIsOpenCodeV2.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('command generation', () => {
    it.each([
      { agentType: 'cursor', command: 'cursor-agent' },
      { agentType: 'claude', command: 'claude' },
      { agentType: 'gemini', command: 'gemini' },
      { agentType: 'codex', command: 'codex' },
      { agentType: 'glm', command: 'claude' },
      { agentType: 'kimi', command: 'claude' },
      { agentType: 'grok', command: 'grok' },
    ] as const)(
      'should use $command command for $agentType type',
      async ({ agentType, command }) => {
        const executor = new AgentExecutor(
          createExecutionConfig(agentType, { glmApiKey: 'zai-secret', kimiApiKey: 'kimi-secret' })
        )

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        expect(mockSpawn).toHaveBeenCalledWith(command, expect.any(Array), expect.any(Object))
      }
    )

    it('should spawn the CLI without a shell', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn.mock.calls[0][2].shell).toBe(false)
    })

    it('should use agy with streaming JSON output for antigravity type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('antigravity'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'agy',
        expect.arrayContaining(['--output-format', 'stream-json', '-p']),
        expect.any(Object)
      )
    })

    it('should place OpenCode 1 run options after the run subcommand', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('opencode', { model: 'provider/model', effort: 'high' })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn.mock.calls[0][0]).toBe('opencode')
      expect(spawnArgs().slice(0, -1)).toEqual([
        'run',
        '--model',
        'provider/model',
        '--variant',
        'high',
        '--format',
        'json',
        '--auto',
      ])
    })

    it('should use Command Code in headless JSON mode without persisting a session', async () => {
      const executor = new AgentExecutor(createExecutionConfig('command-code'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'command-code',
        expect.arrayContaining([
          '--output-format',
          'json',
          '--trust',
          '--no-session',
          '--skip-onboarding',
          '-p',
        ]),
        expect.any(Object)
      )
    })
  })

  describe('global model and effort options', () => {
    it.each([
      { agentType: 'codex', model: 'gpt-5.6-luna', expected: ['--model', 'gpt-5.6-luna'] },
      { agentType: 'kimi', model: 'kimi-for-coding', expected: ['--model', 'kimi-for-coding'] },
    ] as const)(
      'should pass AGENT_MODEL as --model for $agentType',
      async ({ agentType, model, expected }) => {
        const executor = new AgentExecutor(
          createExecutionConfig(agentType, { model, kimiApiKey: 'kimi-secret' })
        )

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining([...expected]))
      }
    )

    it.each([
      { agentType: 'codex', expected: ['-c', 'model_reasoning_effort="high"'] },
      { agentType: 'claude', expected: ['--effort', 'high'] },
      { agentType: 'glm', expected: ['--effort', 'high'] },
      { agentType: 'kimi', expected: ['--effort', 'high'] },
      { agentType: 'grok', expected: ['--reasoning-effort', 'high'] },
      { agentType: 'antigravity', expected: ['--effort', 'high'] },
      { agentType: 'command-code', expected: ['--effort', 'high'] },
    ] as const)('should map effort for $agentType', async ({ agentType, expected }) => {
      const executor = new AgentExecutor(
        createExecutionConfig(agentType, {
          effort: 'high',
          ...(agentType === 'glm' && { glmApiKey: 'zai-secret' }),
          ...(agentType === 'kimi' && { kimiApiKey: 'kimi-secret' }),
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining([...expected]))
    })

    it.each(['cursor', 'gemini'] as const)(
      'should reject effort for %s when construction bypasses ServerConfig',
      async (agentType) => {
        const executor = new AgentExecutor(createExecutionConfig(agentType, { effort: 'high' }))

        const result = await executor.executeAgent({
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: '/tmp',
        })

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toMatch(/AGENT_EFFORT is not supported/)
        expect(mockSpawn).not.toHaveBeenCalled()
      }
    )
  })

  describe('OpenCode isolation and permissions', () => {
    it.each([
      { permission: 'read-only', edit: 'deny', bash: undefined, externalDirectory: 'deny' },
      { permission: 'safe-edit', edit: 'allow', bash: 'allow', externalDirectory: 'deny' },
    ] as const)(
      'should map $permission permissions without changing the global backend model',
      async ({ permission, edit, bash, externalDirectory }) => {
        const executor = new AgentExecutor(
          createExecutionConfig('opencode', { permission, model: 'provider/model' })
        )

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        const options = mockSpawn.mock.calls[0][2]
        const permissionJson = options.env.OPENCODE_PERMISSION
        if (!permissionJson) {
          throw new Error('Expected OpenCode permission configuration')
        }
        const permissionConfig = JSON.parse(permissionJson)
        expect(permissionConfig.edit).toBe(edit)
        expect(permissionConfig.bash).toBe(bash)
        expect(permissionConfig.external_directory).toBe(externalDirectory)
        expect(mockSpawn.mock.calls[0][1]).toEqual(
          expect.arrayContaining(['--model', 'provider/model'])
        )
      }
    )

    it('should isolate and clean OpenCode data and state directories per run', async () => {
      const executor = new AgentExecutor(createExecutionConfig('opencode'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const options = mockSpawn.mock.calls[0][2]
      const dataHome = options.env.XDG_DATA_HOME
      const stateHome = options.env.XDG_STATE_HOME
      if (!dataHome || !stateHome) {
        throw new Error('Expected isolated OpenCode data and state directories')
      }
      expect(dataHome).toContain('subagent-opencode-')
      expect(stateHome).toContain('subagent-opencode-')
      expect(fs.existsSync(dataHome)).toBe(false)
      expect(fs.existsSync(stateHome)).toBe(false)
    })

    it('should copy existing OpenCode authentication into the isolated data home', async () => {
      vi.stubEnv('XDG_DATA_HOME', '/user/data')
      const copySpy = vi.spyOn(fs.promises, 'copyFile').mockResolvedValue()
      const executor = new AgentExecutor(createExecutionConfig('opencode'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(copySpy).toHaveBeenCalledWith(
        '/user/data/opencode/auth.json',
        expect.stringMatching(/subagent-opencode-.*\/data\/opencode\/auth\.json$/)
      )
    })

    it('should pass the working directory to OpenCode through PWD', async () => {
      const executor = new AgentExecutor(createExecutionConfig('opencode'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/work/dir' })

      expect(mockSpawn.mock.calls[0][2].env.PWD).toBe('/work/dir')
    })

    it('should run OpenCode 2 on a private server with config permissions and a model variant', async () => {
      mockIsOpenCodeV2.mockResolvedValue(true)
      vi.stubEnv('XDG_DATA_HOME', '/user/data')
      const executor = new AgentExecutor(
        createExecutionConfig('opencode', {
          permission: 'read-only',
          model: 'provider/model',
          effort: 'high',
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(spawnArgs().slice(0, -1)).toEqual([
        'run',
        '--standalone',
        '--model',
        'provider/model#high',
        '--format',
        'json',
        '--auto',
      ])
      const env = mockSpawn.mock.calls[0][2].env
      expect(env.OPENCODE_PERMISSION).toBeUndefined()
      expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}')).toEqual({
        permission: {
          edit: 'deny',
          task: 'deny',
          external_directory: 'deny',
          question: 'deny',
        },
      })
      expect(env.XDG_DATA_HOME).toBe('/user/data')
    })

    it('should reject OpenCode 2 effort without a model before spawning', async () => {
      mockIsOpenCodeV2.mockResolvedValue(true)
      const executor = new AgentExecutor(createExecutionConfig('opencode', { effort: 'high' }))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/requires AGENT_MODEL/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('should warn and continue when OpenCode authentication cannot be copied', async () => {
      const copyError = Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      vi.spyOn(fs.promises, 'copyFile').mockRejectedValue(copyError)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const executor = new AgentExecutor(createExecutionConfig('opencode'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(0)
      expect(
        consoleSpy.mock.calls.some(([message]) =>
          String(message).includes('Could not copy OpenCode authentication')
        )
      ).toBe(true)
    })
  })

  describe('agentsSettingsPath handling', () => {
    it('should pass --settings argument for claude when agentsSettingsPath is set', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('claude', {
          agentsSettingsPath: '/path/to/claude/settings.json',
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--settings', '/path/to/claude/settings.json']),
        expect.any(Object)
      )
    })

    it.each([
      { agentType: 'cursor', envVar: 'CURSOR_CONFIG_DIR' },
      { agentType: 'codex', envVar: 'CODEX_HOME' },
    ] as const)(
      'should set $envVar env for $agentType when agentsSettingsPath is set',
      async ({ agentType, envVar }) => {
        const executor = new AgentExecutor(
          createExecutionConfig(agentType, { agentsSettingsPath: '/path/to/settings' })
        )

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        expect(mockSpawn.mock.calls[0][2].env[envVar]).toBe('/path/to/settings')
      }
    )

    it.each([
      { agentType: 'gemini', settingsPath: '/path/to/gemini/settings' },
      { agentType: 'grok', settingsPath: '/path/to/grok/settings' },
      { agentType: 'kimi', settingsPath: '/path/to/claude/settings.json' },
    ] as const)(
      'should not pass agentsSettingsPath to $agentType',
      async ({ agentType, settingsPath }) => {
        const executor = new AgentExecutor(
          createExecutionConfig(agentType, {
            agentsSettingsPath: settingsPath,
            kimiApiKey: 'kimi-secret',
          })
        )

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        const args = spawnArgs()
        const spawnEnv = mockSpawn.mock.calls[0][2].env
        expect(args).not.toContain(settingsPath)
        expect(Object.values(spawnEnv)).not.toContain(settingsPath)
      }
    )

    it('should not pass --settings for claude when agentsSettingsPath is not set', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1]
      expect(args).not.toContain('--settings')
    })

    it.each([
      { agentType: 'cursor', envVar: 'CURSOR_CONFIG_DIR' },
      { agentType: 'codex', envVar: 'CODEX_HOME' },
    ] as const)(
      'should not set $envVar env for $agentType when agentsSettingsPath is not set',
      async ({ agentType, envVar }) => {
        const executor = new AgentExecutor(createExecutionConfig(agentType))

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        expect(mockSpawn.mock.calls[0][2].env[envVar]).toBeUndefined()
      }
    )
  })

  describe('cursor API key handling', () => {
    it('should pass cursorApiKey through CURSOR_API_KEY env and never as a CLI argument', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('cursor', { cursorApiKey: 'secret-key-123' })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = spawnArgs()
      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['CURSOR_API_KEY']).toBe('secret-key-123')
      expect(args).not.toContain('-a')
      expect(args).not.toContain('secret-key-123')
    })

    it('should not set CURSOR_API_KEY when cursorApiKey is not configured', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['CURSOR_API_KEY']).toBeUndefined()
    })
  })

  describe('glm and kimi API key handling', () => {
    it.each([
      {
        agentType: 'glm',
        overrides: { glmApiKey: 'zai-secret' },
        baseUrl: 'https://api.z.ai/api/anthropic',
        credentialVar: 'ANTHROPIC_AUTH_TOKEN',
        apiKey: 'zai-secret',
      },
      {
        agentType: 'kimi',
        overrides: { kimiApiKey: 'kimi-secret' },
        baseUrl: 'https://api.kimi.com/coding/',
        credentialVar: 'ANTHROPIC_API_KEY',
        apiKey: 'kimi-secret',
      },
    ] as const)(
      'should route $agentType via env without exposing the API key in argv',
      async ({ agentType, overrides, baseUrl, credentialVar, apiKey }) => {
        const executor = new AgentExecutor(createExecutionConfig(agentType, overrides))

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        const args = spawnArgs()
        const spawnEnv = mockSpawn.mock.calls[0][2].env
        expect(spawnEnv['ANTHROPIC_BASE_URL']).toBe(baseUrl)
        expect(spawnEnv[credentialVar]).toBe(apiKey)
        expect(args).not.toContain(apiKey)
      }
    )

    it.each([
      {
        agentType: 'glm',
        overrides: { glmApiKey: 'zai-secret' },
        conflictingVar: 'ANTHROPIC_API_KEY',
        credentialVar: 'ANTHROPIC_AUTH_TOKEN',
        apiKey: 'zai-secret',
      },
      {
        agentType: 'kimi',
        overrides: { kimiApiKey: 'kimi-secret' },
        conflictingVar: 'ANTHROPIC_AUTH_TOKEN',
        credentialVar: 'ANTHROPIC_API_KEY',
        apiKey: 'kimi-secret',
      },
    ] as const)(
      'should remove inherited $conflictingVar for $agentType subprocesses',
      async ({ agentType, overrides, conflictingVar, credentialVar, apiKey }) => {
        vi.stubEnv(conflictingVar, 'anthropic-secret')
        const executor = new AgentExecutor(createExecutionConfig(agentType, overrides))

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        const spawnEnv = mockSpawn.mock.calls[0][2].env
        expect(spawnEnv[conflictingVar]).toBeUndefined()
        expect(spawnEnv[credentialVar]).toBe(apiKey)
      }
    )

    it.each([
      { agentType: 'glm', keyState: 'missing', overrides: {} },
      { agentType: 'glm', keyState: 'blank', overrides: { glmApiKey: '   ' } },
      { agentType: 'kimi', keyState: 'missing', overrides: {} },
      { agentType: 'kimi', keyState: 'blank', overrides: { kimiApiKey: '   ' } },
    ] as const)(
      'should fail before spawn when $agentType API key is $keyState',
      async ({ agentType, overrides }) => {
        const executor = new AgentExecutor(createExecutionConfig(agentType, overrides))

        const result = await executor.executeAgent({
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: '/tmp',
        })

        expect(mockSpawn).not.toHaveBeenCalled()
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('CLI_API_KEY')
        expect(result.stderr).toContain('restart or reconnect the MCP server')
      }
    )
  })

  describe('system prompt separation', () => {
    it('should use --append-system-prompt for claude instead of concatenation', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/test/cwd' })

      const args = spawnArgs()

      expect(args).toContain('--append-system-prompt')
      const spIdx = args.indexOf('--append-system-prompt')
      const systemPrompt = args[spIdx + 1]
      expect(systemPrompt).toContain('cwd: /test/cwd')
      expect(systemPrompt).toContain('test-agent')

      const pIdx = args.indexOf('-p')
      expect(args[pIdx + 1]).toBe('Test prompt')
      expect(args[pIdx + 1]).not.toContain('[System Context]')
    })

    it('should use process.cwd() as cwd fallback in claude system prompt when cwd is omitted', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))
      const expectedCwd = process.cwd()

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt' })

      const args = spawnArgs()
      const spIdx = args.indexOf('--append-system-prompt')
      const systemPrompt = args[spIdx + 1]
      expect(systemPrompt).toContain(`cwd: ${expectedCwd}`)
    })

    it.each([
      { agentType: 'glm', overrides: { glmApiKey: 'zai-secret' } },
      { agentType: 'kimi', overrides: { kimiApiKey: 'kimi-secret' } },
    ] as const)(
      'should use --system-prompt for $agentType instead of appending Claude defaults',
      async ({ agentType, overrides }) => {
        const executor = new AgentExecutor(createExecutionConfig(agentType, overrides))

        await executor.executeAgent({
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: '/test/cwd',
        })

        const args = spawnArgs()

        expect(args).toContain('--system-prompt')
        expect(args).not.toContain('--append-system-prompt')
        const spIdx = args.indexOf('--system-prompt')
        const systemPrompt = args[spIdx + 1]
        expect(systemPrompt).toContain('cwd: /test/cwd')
        expect(systemPrompt).toContain('test-agent')

        const pIdx = args.indexOf('-p')
        expect(args[pIdx + 1]).toBe('Test prompt')
      }
    )

    it('should set GEMINI_SYSTEM_MD env for gemini when agentFilePath is provided', async () => {
      const executor = new AgentExecutor(createExecutionConfig('gemini'))

      await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
        agentFilePath: '/path/to/agent.md',
      })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['GEMINI_SYSTEM_MD']).toBe('/path/to/agent.md')

      const args = spawnArgs()
      const pIdx = args.indexOf('-p')
      expect(args[pIdx + 1]).toBe('Test prompt')
      expect(args[pIdx + 1]).not.toContain('[System Context]')
    })

    it.each(['gemini', 'cursor', 'grok', 'antigravity'] as const)(
      'should concatenate system context and user prompt into the -p argument for %s',
      async (agentType) => {
        const executor = new AgentExecutor(createExecutionConfig(agentType))

        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

        const args = spawnArgs()
        const pIdx = args.indexOf('-p')
        const promptArg = args[pIdx + 1]
        expect(promptArg).toContain('[System Context]')
        expect(promptArg).toContain('test-agent')
        expect(promptArg).toContain('[User Prompt]')
        expect(promptArg).toContain('Test prompt')
      }
    )
  })

  describe('executeAgent', () => {
    it('should return successful result with parsed JSON on success', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Help me',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(0)
      expect(result.hasResult).toBe(true)
      expect(result.resultJson).toEqual({
        type: 'result',
        result: 'Test execution successful',
      })
      expect(result.executionTime).toBeGreaterThan(0)
    })

    it('should return non-zero exit code and error message on failure', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stderrData: 'Agent not found or execution failed',
          exitCode: 1,
          triggerError: new Error('Spawn execution failed'),
        })
      )

      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      const result = await executor.executeAgent({
        agent: 'nonexistent-agent',
        prompt: 'This should fail',
        cwd: '/tmp',
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Agent not found')
      expect(result.hasResult).toBe(false)
      expect(result.resultJson).toBeUndefined()
    })

    it('should pass a large prompt to the CLI without truncating it', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))
      const largePrompt = 'Large complex task requiring extensive output'.repeat(100)

      await executor.executeAgent({ agent: 'test-agent', prompt: largePrompt, cwd: '/tmp' })

      const args = spawnArgs()
      expect(args[args.indexOf('-p') + 1]).toContain(largePrompt)
    })

    it('should parse grok pretty JSON output after process exit', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData:
            '{\n' +
            '  "text": "Grok execution successful",\n' +
            '  "stopReason": "EndTurn",\n' +
            '  "sessionId": "session-123",\n' +
            '  "requestId": "request-123"\n' +
            '}\n',
        })
      )

      const executor = new AgentExecutor(createExecutionConfig('grok'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Help me',
        cwd: '/tmp',
      })

      expect(result.hasResult).toBe(true)
      expect(result.resultJson).toMatchObject({ result: 'Grok execution successful' })
    })

    it('should ignore a non-terminal Claude event and keep reading until the result', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData:
            '{"message":"Background operation completed"}\n' +
            '{"type":"result","result":"actual response"}\n',
        })
      )
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Help me',
        cwd: '/tmp',
      })

      expect(result.hasResult).toBe(true)
      expect(result.resultJson).toMatchObject({
        type: 'result',
        result: 'actual response',
      })
    })
  })

  describe('error handling', () => {
    it('should reject empty execution parameters', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await expect(executor.executeAgent({ agent: '', prompt: '', cwd: '/tmp' })).rejects.toThrow(
        /agent and prompt/i
      )
    })

    it('should handle timeout scenarios', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          noClose: true, // Simulate a process that never finishes
        })
      )

      const executor = new AgentExecutor(createExecutionConfig('cursor', { executionTimeout: 100 }))

      const result = await executor.executeAgent({
        agent: 'slow-agent',
        prompt: 'This takes a long time',
        cwd: '/tmp',
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('timeout')
    })
  })

  describe('permission flag mapping', () => {
    it('should prepend codex safe-edit flags before the exec subcommand', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('codex', { permission: 'safe-edit' })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(spawnArgs().slice(0, 5)).toEqual([
        '-s',
        'workspace-write',
        '-c',
        'approval_policy=never',
        'exec',
      ])
    })

    it.each([
      { label: 'no overrides', overrides: undefined },
      { label: 'permission: undefined', overrides: { permission: undefined } },
    ])('should default claude to safe-edit with $label', async ({ overrides }) => {
      const executor = new AgentExecutor(createExecutionConfig('claude', overrides))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(spawnArgs().slice(0, 2)).toEqual(['--permission-mode', 'acceptEdits'])
    })
  })

  describe('new required CLI flags', () => {
    it('should include --skip-git-repo-check for codex', async () => {
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = spawnArgs()
      expect(args).toContain('--skip-git-repo-check')
    })

    it.each([
      { label: 'without agentFilePath', agentFilePath: undefined },
      { label: 'with agentFilePath', agentFilePath: '/path/to/agent.md' },
    ])('should include --skip-trust for gemini $label', async ({ agentFilePath }) => {
      const executor = new AgentExecutor(createExecutionConfig('gemini'))

      await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
        agentFilePath,
      })

      const args = spawnArgs()
      expect(args).toContain('--skip-trust')
    })

    it('should pass the working directory to grok through --cwd', async () => {
      const executor = new AgentExecutor(createExecutionConfig('grok'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/work/dir' })

      const args = spawnArgs()
      expect(args[args.indexOf('--cwd') + 1]).toBe('/work/dir')
    })
  })

  describe('codex prompt assembly', () => {
    it('should concatenate system context into the prompt regardless of agentFilePath', async () => {
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
        agentFilePath: '/path/to/agent.md',
      })

      const args = spawnArgs()
      const promptArg = args[args.length - 1]
      expect(promptArg).toContain('[System Context]')
      expect(promptArg).toContain('test-agent')
      expect(promptArg).toContain('[User Prompt]')
      expect(promptArg).toContain('Test prompt')
      expect(args.some((a) => a.startsWith('model_instructions_file='))).toBe(false)
    })
  })

  describe('SIGTERM and partial results', () => {
    it('should handle SIGTERM (exit code 143) as normal when hasResult is true', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData: '{"type": "result", "result": "Success"}\n',
          exitCode: 143,
        })
      )

      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Stream JSON data',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(143)
      expect(result.hasResult).toBe(true)
      expect(result.resultJson).toBeDefined()
    })

    it('should preserve a result when SIGTERM escalates to SIGKILL', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData: '{"type": "result", "result": "Success"}\n',
          noClose: true,
        })
      )
      const executor = new AgentExecutor(
        createExecutionConfig('cursor', { executionTimeout: 5000 })
      )

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Stream JSON data',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(137)
      expect(result.hasResult).toBe(true)
    })

    it('should distinguish timeout with partial result from complete timeout', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData: '{"type": "result", "result": "Partial", "status": "partial"}\n',
          stdoutDelay: 50,
          noClose: true, // Let timeout handler fire
        })
      )

      const executor = new AgentExecutor(createExecutionConfig('cursor', { executionTimeout: 100 }))

      const result = await executor.executeAgent({
        agent: 'partial-agent',
        prompt: 'Partial completion',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(124)
      expect(result.hasResult).toBe(true)
      expect(result.resultJson).toEqual({
        type: 'result',
        result: 'Partial',
        status: 'partial',
      })
    })
  })

  describe('process resource limits', () => {
    it('should stop and report an error when combined output exceeds the capture limit', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData: 'output larger than the configured limit',
        })
      )
      const executor = new AgentExecutor(createExecutionConfig('cursor', { maxOutputBytes: 8 }))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Produce output',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('exceeded 8 bytes')
      expect(result.stdout).toBe('output l')
      expect(mockSpawn.mock.results[0]?.value.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('should decode UTF-8 characters split across stdout chunks', async () => {
      const output = Buffer.from('{"type":"result","result":"日本語"}\n')
      const splitAt = output.indexOf(Buffer.from('日')) + 1
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutChunks: [output.subarray(0, splitAt), output.subarray(splitAt)],
        })
      )
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Produce output',
        cwd: '/tmp',
      })

      expect(result.resultJson).toEqual({ type: 'result', result: '日本語' })
    })

    it('should not emit a replacement character when the byte cap splits UTF-8', async () => {
      mockSpawn.mockImplementationOnce(() => createMockProcess({ stdoutData: 'abc日' }))
      const executor = new AgentExecutor(createExecutionConfig('cursor', { maxOutputBytes: 4 }))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Produce output',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('abc')
      expect(result.stdout).not.toContain('�')
    })

    it('should return exit code 127 when the CLI cannot be spawned', async () => {
      const unavailable = Object.assign(new Error('spawn cursor-agent ENOENT'), { code: 'ENOENT' })
      mockSpawn.mockImplementationOnce(() => createMockProcess({ triggerError: unavailable }))
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Run',
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(127)
      expect(result.stderr).toContain('ENOENT')
    })
  })

  describe('cancellation', () => {
    it('should terminate the agent process when the request is aborted', async () => {
      const controller = new AbortController()
      // noClose keeps the process alive until it is killed, mirroring an agent
      // that is still working when the client cancels.
      mockSpawn.mockImplementationOnce(() => createMockProcess({ noClose: true }))

      const executor = new AgentExecutor(createExecutionConfig('cursor'))
      const pending = executor.executeAgent(
        { agent: 'test-agent', prompt: 'Long task', cwd: '/tmp' },
        controller.signal
      )

      controller.abort()
      const result = await pending

      const spawned = mockSpawn.mock.results[0]?.value
      expect(spawned.kill).toHaveBeenCalledWith('SIGTERM')
      expect(result.exitCode).toBe(130)
      expect(result.stderr).toContain('cancelled')
    })

    it('should terminate the agent process when the executor is shut down', async () => {
      mockSpawn.mockImplementationOnce(() => createMockProcess({ noClose: true }))

      const executor = new AgentExecutor(createExecutionConfig('cursor'))
      const pending = executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Long task',
        cwd: '/tmp',
      })

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      executor.terminateAll()
      const result = await pending

      expect(result.exitCode).toBe(130)
    })
  })
})
