import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionParams } from '../../types/ExecutionParams.js'
import {
  AgentExecutor,
  type AgentPermission,
  type AgentType,
  createExecutionConfig,
  DEFAULT_EXECUTION_TIMEOUT,
} from '../AgentExecutor.js'

// Mock child_process module
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Import the mocked module to get references
import { spawn as mockSpawn } from 'node:child_process'

/**
 * Creates a minimal mock process for spawn.
 * Each test configures its own mock via mockImplementationOnce.
 */
function createMockProcess(options: {
  stdoutData?: string
  stdoutDelay?: number
  stderrData?: string
  exitCode?: number
  closeDelay?: number
  noClose?: boolean
  triggerError?: Error
}) {
  const {
    stdoutData,
    stdoutDelay = 10,
    stderrData,
    exitCode = 0,
    closeDelay = 50,
    noClose = false,
    triggerError,
  } = options

  return {
    stdin: { end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stdoutData) {
          setTimeout(() => callback(Buffer.from(stdoutData)), stdoutDelay)
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
      if (event === 'close' && !noClose) {
        setTimeout(() => callback(exitCode), closeDelay)
      }
      if (event === 'error' && triggerError) {
        setTimeout(() => callback(triggerError), stdoutDelay)
      }
    }),
    kill: vi.fn(),
  } as any
}

/** Creates a success mock process that emits a JSON result */
function createSuccessMock(data = 'Test execution successful') {
  return createMockProcess({
    stdoutData: `${JSON.stringify({ type: 'result', data })}\n`,
  })
}

describe('AgentExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: success mock. Tests that need different behavior override with mockImplementationOnce.
    mockSpawn.mockImplementation(() => createSuccessMock())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('createExecutionConfig', () => {
    it('should create config with default timeout when no overrides provided', () => {
      const config = createExecutionConfig('cursor')

      expect(config.agentType).toBe('cursor')
      expect(config.executionTimeout).toBe(DEFAULT_EXECUTION_TIMEOUT)
    })

    it('should allow overriding execution timeout', () => {
      const customTimeout = 15000
      const config = createExecutionConfig('cursor', { executionTimeout: customTimeout })

      expect(config.executionTimeout).toBe(customTimeout)
    })

    it('should support all agent types', () => {
      const cursorConfig = createExecutionConfig('cursor')
      const claudeConfig = createExecutionConfig('claude')
      const geminiConfig = createExecutionConfig('gemini')
      const codexConfig = createExecutionConfig('codex')
      const glmConfig = createExecutionConfig('glm')
      const grokConfig = createExecutionConfig('grok')

      expect(cursorConfig.agentType).toBe('cursor')
      expect(claudeConfig.agentType).toBe('claude')
      expect(geminiConfig.agentType).toBe('gemini')
      expect(codexConfig.agentType).toBe('codex')
      expect(glmConfig.agentType).toBe('glm')
      expect(grokConfig.agentType).toBe('grok')
    })

    it('should allow setting agentsSettingsPath', () => {
      const config = createExecutionConfig('claude', {
        agentsSettingsPath: '/path/to/settings',
      })

      expect(config.agentsSettingsPath).toBe('/path/to/settings')
    })

    it('should have undefined agentsSettingsPath when not provided', () => {
      const config = createExecutionConfig('cursor')

      expect(config.agentsSettingsPath).toBeUndefined()
    })

    it('should allow setting cursorApiKey', () => {
      const config = createExecutionConfig('cursor', {
        cursorApiKey: 'test-key-123',
      })

      expect(config.cursorApiKey).toBe('test-key-123')
    })
  })

  describe('command generation', () => {
    it('should use cursor-agent command for cursor type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith('cursor-agent', expect.any(Array), expect.any(Object))
    })

    it('should use claude command for claude type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith('claude', expect.any(Array), expect.any(Object))
    })

    it('should use gemini command for gemini type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('gemini'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith('gemini', expect.any(Array), expect.any(Object))
    })

    it('should use codex command for codex type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith('codex', expect.any(Array), expect.any(Object))
    })

    it('should use claude command for glm type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('glm', { glmApiKey: 'zai-secret' }))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith('claude', expect.any(Array), expect.any(Object))
    })

    it('should use grok command for grok type', async () => {
      const executor = new AgentExecutor(createExecutionConfig('grok'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith('grok', expect.any(Array), expect.any(Object))
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

    it('should set CURSOR_CONFIG_DIR env for cursor when agentsSettingsPath is set', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('cursor', {
          agentsSettingsPath: '/path/to/cursor/config',
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'cursor-agent',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            CURSOR_CONFIG_DIR: '/path/to/cursor/config',
          }),
        })
      )
    })

    it('should set CODEX_HOME env for codex when agentsSettingsPath is set', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('codex', {
          agentsSettingsPath: '/path/to/codex/home',
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'codex',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            CODEX_HOME: '/path/to/codex/home',
          }),
        })
      )
    })

    it('should not modify env for gemini when agentsSettingsPath is set', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('gemini', {
          agentsSettingsPath: '/path/to/gemini/settings',
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['GEMINI_CONFIG_DIR']).toBeUndefined()
      expect(spawnEnv['GEMINI_HOME']).toBeUndefined()
    })

    it('should not modify env for grok when agentsSettingsPath is set', async () => {
      const settingsPath = '/path/to/grok/settings'
      const executor = new AgentExecutor(
        createExecutionConfig('grok', {
          agentsSettingsPath: settingsPath,
        })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(args).not.toContain(settingsPath)
      expect(Object.values(spawnEnv)).not.toContain(settingsPath)
    })

    it('should not pass --settings for claude when agentsSettingsPath is not set', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1]
      expect(args).not.toContain('--settings')
    })

    it('should not set CURSOR_CONFIG_DIR env for cursor when agentsSettingsPath is not set', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['CURSOR_CONFIG_DIR']).toBeUndefined()
    })

    it('should not set CODEX_HOME env for codex when agentsSettingsPath is not set', async () => {
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['CODEX_HOME']).toBeUndefined()
    })
  })

  describe('cursor API key handling', () => {
    it('should set CURSOR_API_KEY env when cursorApiKey is configured', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('cursor', { cursorApiKey: 'secret-key-123' })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['CURSOR_API_KEY']).toBe('secret-key-123')
    })

    it('should not pass API key as CLI argument (avoid ps exposure)', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('cursor', { cursorApiKey: 'secret-key-123' })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
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

  describe('glm API key handling', () => {
    it('should route glm to Z.ai via env without exposing the API key in argv', async () => {
      const executor = new AgentExecutor(createExecutionConfig('glm', { glmApiKey: 'zai-secret' }))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['ANTHROPIC_BASE_URL']).toBe('https://api.z.ai/api/anthropic')
      expect(spawnEnv['ANTHROPIC_AUTH_TOKEN']).toBe('zai-secret')
      expect(args).not.toContain('zai-secret')
    })

    it('should remove inherited ANTHROPIC_API_KEY for glm subprocesses', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-real')
      const executor = new AgentExecutor(createExecutionConfig('glm', { glmApiKey: 'zai-secret' }))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(spawnEnv['ANTHROPIC_AUTH_TOKEN']).toBe('zai-secret')
    })

    it('should fail before spawn when glm API key is missing', async () => {
      const executor = new AgentExecutor(createExecutionConfig('glm'))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
      })

      expect(mockSpawn).not.toHaveBeenCalled()
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('CLI_API_KEY')
      expect(result.stderr).toContain('restart or reconnect the MCP server')
    })

    it('should fail before spawn when glm API key is blank', async () => {
      const executor = new AgentExecutor(createExecutionConfig('glm', { glmApiKey: '   ' }))

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
      })

      expect(mockSpawn).not.toHaveBeenCalled()
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('CLI_API_KEY')
    })
  })

  describe('system prompt separation', () => {
    it('should use --append-system-prompt for claude instead of concatenation', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/test/cwd' })

      const args = mockSpawn.mock.calls[0][1] as string[]

      // Should have --append-system-prompt with cwd prefix and agent content
      expect(args).toContain('--append-system-prompt')
      const spIdx = args.indexOf('--append-system-prompt')
      const systemPrompt = args[spIdx + 1]
      expect(systemPrompt).toContain('cwd: /test/cwd')
      expect(systemPrompt).toContain('test-agent')

      // User prompt should be separate via -p (not concatenated)
      const pIdx = args.indexOf('-p')
      expect(args[pIdx + 1]).toBe('Test prompt')
      expect(args[pIdx + 1]).not.toContain('[System Context]')
    })

    it('should use process.cwd() as cwd fallback in claude system prompt when cwd is omitted', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))
      const expectedCwd = process.cwd()

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const spIdx = args.indexOf('--append-system-prompt')
      const systemPrompt = args[spIdx + 1]
      expect(systemPrompt).toContain(`cwd: ${expectedCwd}`)
    })

    it('should use --system-prompt for glm instead of appending Claude defaults', async () => {
      const executor = new AgentExecutor(createExecutionConfig('glm', { glmApiKey: 'zai-secret' }))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/test/cwd' })

      const args = mockSpawn.mock.calls[0][1] as string[]

      expect(args).toContain('--system-prompt')
      expect(args).not.toContain('--append-system-prompt')
      const spIdx = args.indexOf('--system-prompt')
      const systemPrompt = args[spIdx + 1]
      expect(systemPrompt).toContain('cwd: /test/cwd')
      expect(systemPrompt).toContain('test-agent')

      const pIdx = args.indexOf('-p')
      expect(args[pIdx + 1]).toBe('Test prompt')
    })

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

      // User prompt should be separate (not concatenated)
      const args = mockSpawn.mock.calls[0][1] as string[]
      const pIdx = args.indexOf('-p')
      expect(args[pIdx + 1]).toBe('Test prompt')
      expect(args[pIdx + 1]).not.toContain('[System Context]')
    })

    it('should set GEMINI_SYSTEM_MD correctly when agentsSettingsPath is also configured', async () => {
      const executor = new AgentExecutor(
        createExecutionConfig('gemini', {
          agentsSettingsPath: '/path/to/settings',
        })
      )

      await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
        agentFilePath: '/path/to/agent.md',
      })

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv['GEMINI_SYSTEM_MD']).toBe('/path/to/agent.md')

      // User prompt should still be separate
      const args = mockSpawn.mock.calls[0][1] as string[]
      const pIdx = args.indexOf('-p')
      expect(args[pIdx + 1]).toBe('Test prompt')
    })

    it('should fall back to concatenation for gemini without agentFilePath', async () => {
      const executor = new AgentExecutor(createExecutionConfig('gemini'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const pIdx = args.indexOf('-p')
      const promptArg = args[pIdx + 1]
      expect(promptArg).toContain('[System Context]')
      expect(promptArg).toContain('test-agent')
      expect(promptArg).toContain('[User Prompt]')
      expect(promptArg).toContain('Test prompt')
    })

    it('should concatenate for codex with both system context and user prompt', async () => {
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const promptArg = args[args.length - 1]
      expect(promptArg).toContain('[System Context]')
      expect(promptArg).toContain('test-agent')
      expect(promptArg).toContain('[User Prompt]')
      expect(promptArg).toContain('Test prompt')
    })

    it('should concatenate for cursor with both system context and user prompt', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const pIdx = args.indexOf('-p')
      const promptArg = args[pIdx + 1]
      expect(promptArg).toContain('[System Context]')
      expect(promptArg).toContain('test-agent')
      expect(promptArg).toContain('[User Prompt]')
      expect(promptArg).toContain('Test prompt')
    })

    it('should concatenate for grok with both system context and user prompt', async () => {
      const executor = new AgentExecutor(createExecutionConfig('grok'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const pIdx = args.indexOf('-p')
      const promptArg = args[pIdx + 1]
      expect(promptArg).toContain('[System Context]')
      expect(promptArg).toContain('test-agent')
      expect(promptArg).toContain('[User Prompt]')
      expect(promptArg).toContain('Test prompt')
    })
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
        data: 'Test execution successful',
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

    it('should handle large prompts without truncation', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))
      const largePrompt = 'Generate detailed documentation'.repeat(200)

      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: largePrompt,
        cwd: '/tmp',
      })

      expect(result.exitCode).toBe(0)
      expect(result.hasResult).toBe(true)
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-p', expect.stringContaining('Generate detailed documentation')]),
        expect.any(Object)
      )
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

      expect(result.exitCode).toBe(0)
      expect(result.hasResult).toBe(true)
      expect(result.resultJson).toEqual({
        type: 'result',
        result: 'Grok execution successful',
        status: 'success',
        stop_reason: 'EndTurn',
        session_id: 'session-123',
        request_id: 'request-123',
      })
    })
  })

  describe('execution performance monitoring', () => {
    it('should measure execution time accurately', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      const startTime = Date.now()
      const result = await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Quick task',
        cwd: '/tmp',
      })
      const endTime = Date.now()

      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.executionTime).toBeLessThanOrEqual(endTime - startTime + 100)
    })
  })

  describe('error handling', () => {
    it('should handle invalid execution parameters', async () => {
      const executor = new AgentExecutor(createExecutionConfig('cursor'))

      await expect(
        executor.executeAgent({ agent: '', prompt: '', cwd: '/tmp' } as ExecutionParams)
      ).rejects.toThrow()
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
    type Case = {
      agent: AgentType
      perm: AgentPermission
      expected: readonly string[]
    }

    const cases: readonly Case[] = [
      // codex
      { agent: 'codex', perm: 'read-only', expected: ['-s', 'read-only'] },
      {
        agent: 'codex',
        perm: 'safe-edit',
        expected: ['-s', 'workspace-write', '-c', 'approval_policy=never'],
      },
      { agent: 'codex', perm: 'yolo', expected: ['--dangerously-bypass-approvals-and-sandbox'] },
      // claude
      { agent: 'claude', perm: 'read-only', expected: ['--permission-mode', 'plan'] },
      { agent: 'claude', perm: 'safe-edit', expected: ['--permission-mode', 'acceptEdits'] },
      { agent: 'claude', perm: 'yolo', expected: ['--dangerously-skip-permissions'] },
      // glm
      { agent: 'glm', perm: 'read-only', expected: ['--permission-mode', 'plan'] },
      { agent: 'glm', perm: 'safe-edit', expected: ['--permission-mode', 'acceptEdits'] },
      { agent: 'glm', perm: 'yolo', expected: ['--dangerously-skip-permissions'] },
      // gemini
      { agent: 'gemini', perm: 'read-only', expected: ['--approval-mode', 'plan'] },
      { agent: 'gemini', perm: 'safe-edit', expected: ['--approval-mode', 'auto_edit'] },
      { agent: 'gemini', perm: 'yolo', expected: ['-y'] },
      // cursor
      { agent: 'cursor', perm: 'read-only', expected: ['--mode', 'plan'] },
      { agent: 'cursor', perm: 'safe-edit', expected: ['--trust'] },
      { agent: 'cursor', perm: 'yolo', expected: ['-f', '--trust'] },
      // grok
      { agent: 'grok', perm: 'read-only', expected: ['--permission-mode', 'dontAsk'] },
      { agent: 'grok', perm: 'safe-edit', expected: ['--permission-mode', 'auto'] },
      { agent: 'grok', perm: 'yolo', expected: ['--permission-mode', 'bypassPermissions'] },
    ]

    it.each(cases)('should prepend $expected for agent=$agent permission=$perm', async ({
      agent,
      perm,
      expected,
    }) => {
      const executor = new AgentExecutor(
        createExecutionConfig(agent, { permission: perm, glmApiKey: 'zai-secret' })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      // Permission flags must occupy the head of argv (before the per-CLI base flags).
      expect(args.slice(0, expected.length)).toEqual(expected)
    })

    it('should default to safe-edit when permission is not specified in createExecutionConfig', async () => {
      const executor = new AgentExecutor(createExecutionConfig('claude'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args.slice(0, 2)).toEqual(['--permission-mode', 'acceptEdits'])
    })

    it('should fall back to safe-edit when overrides.permission is undefined (mocks bypassing TS)', async () => {
      // Simulates a test mock or JS caller that passes { permission: undefined }
      // — without the `??` guard the spread would overwrite the default and
      // leave the sub-agent without any approval flag, deadlocking on prompt.
      const executor = new AgentExecutor(
        createExecutionConfig('claude', { permission: undefined as unknown as AgentPermission })
      )

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args.slice(0, 2)).toEqual(['--permission-mode', 'acceptEdits'])
    })
  })

  describe('new required CLI flags', () => {
    it('should include --skip-git-repo-check for codex', async () => {
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).toContain('--skip-git-repo-check')
    })

    it('should include --skip-trust for gemini unconditionally', async () => {
      const executor = new AgentExecutor(createExecutionConfig('gemini'))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).toContain('--skip-trust')
    })

    it('should include --skip-trust for gemini even when agentFilePath is provided', async () => {
      const executor = new AgentExecutor(createExecutionConfig('gemini'))

      await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
        agentFilePath: '/path/to/agent.md',
      })

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).toContain('--skip-trust')
    })

    it('should include required headless flags for grok read-only', async () => {
      const executor = new AgentExecutor(createExecutionConfig('grok', { permission: 'read-only' }))

      await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })

      const args = mockSpawn.mock.calls[0][1] as string[]
      expect(args).toEqual(
        expect.arrayContaining([
          '--permission-mode',
          'dontAsk',
          '--cwd',
          '/tmp',
          '--output-format',
          'json',
          '--always-approve',
          '--verbatim',
        ])
      )
    })

    it('should not leak codex-specific flags into other CLIs', async () => {
      for (const agent of ['claude', 'gemini', 'cursor', 'glm', 'grok'] as const) {
        mockSpawn.mockClear()
        const executor = new AgentExecutor(
          createExecutionConfig(agent, { glmApiKey: 'zai-secret' })
        )
        await executor.executeAgent({ agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp' })
        const args = mockSpawn.mock.calls[0][1] as string[]
        expect(args).not.toContain('--skip-git-repo-check')
      }
    })
  })

  describe('codex prompt assembly', () => {
    it('should concatenate system context into the prompt regardless of agentFilePath', async () => {
      // codex's `-c model_instructions_file` was deliberately not adopted: it
      // replaces codex's built-in system prompt and measurably increased
      // exploration overhead and token usage in real-task comparisons.
      const executor = new AgentExecutor(createExecutionConfig('codex'))

      await executor.executeAgent({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/tmp',
        agentFilePath: '/path/to/agent.md',
      })

      const args = mockSpawn.mock.calls[0][1] as string[]
      const promptArg = args[args.length - 1]
      expect(promptArg).toContain('[System Context]')
      expect(promptArg).toContain('test-agent')
      expect(promptArg).toContain('[User Prompt]')
      expect(promptArg).toContain('Test prompt')
      // model_instructions_file must never appear in argv.
      expect(args.some((a) => a.startsWith('model_instructions_file='))).toBe(false)
    })
  })

  describe('SIGTERM and partial results', () => {
    it('should handle SIGTERM (exit code 143) as normal when hasResult is true', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData: '{"type": "result", "data": "Success"}\n',
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

    it('should distinguish timeout with partial result from complete timeout', async () => {
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess({
          stdoutData: '{"type": "result", "partial": true}\n',
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
      expect(result.resultJson).toEqual({ type: 'result', partial: true })
    })
  })
})
