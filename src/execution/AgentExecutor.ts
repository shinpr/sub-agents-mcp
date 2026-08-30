import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ExecutionParams } from '../types/ExecutionParams.js'
import { Logger, type LogLevel } from '../utils/Logger.js'
import { StreamProcessor } from './StreamProcessor.js'

export interface AgentExecutionResult {
  stdout: string

  stderr: string

  exitCode: number

  executionTime: number

  hasResult?: boolean

  resultJson?: unknown
}

export interface ExecutionConfig {
  executionTimeout: number

  maxOutputBytes: number

  agentType: AgentType

  permission: AgentPermission

  agentsSettingsPath?: string

  cursorApiKey?: string

  glmApiKey?: string

  kimiApiKey?: string

  model?: string

  effort?: string
}

export const DEFAULT_EXECUTION_TIMEOUT = 300000 // 5 minutes
const MAX_CAPTURED_OUTPUT_BYTES = 16 * 1024 * 1024

const TERMINATION_GRACE_MS = 1000

type EnvOverrides = Record<string, string | null>

const GLM_BASE_URL = 'https://api.z.ai/api/anthropic'
const KIMI_BASE_URL = 'https://api.kimi.com/coding/'

const GLM_MISSING_API_KEY_ERROR =
  'GLM backend needs a Z.ai API token in the CLI_API_KEY environment variable. ' +
  'Add CLI_API_KEY to this MCP server environment in your MCP client configuration, ' +
  'then restart or reconnect the MCP server so the running process receives it. ' +
  'This run will keep failing until the MCP process is restarted with CLI_API_KEY set.'

const KIMI_MISSING_API_KEY_ERROR =
  'Kimi backend needs an API key in the CLI_API_KEY environment variable. ' +
  'Add CLI_API_KEY to this MCP server environment in your MCP client configuration, ' +
  'then restart or reconnect the MCP server so the running process receives it. ' +
  'This run will keep failing until the MCP process is restarted with CLI_API_KEY set.'

export const AGENT_TYPES = [
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
] as const

export type AgentType = (typeof AGENT_TYPES)[number]

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value)
}

export const AGENT_EFFORT_SUPPORTED_TYPES = [
  'codex',
  'claude',
  'glm',
  'kimi',
  'grok',
  'antigravity',
  'opencode',
  'command-code',
] as const

export function supportsAgentEffort(
  agentType: AgentType
): agentType is (typeof AGENT_EFFORT_SUPPORTED_TYPES)[number] {
  return (AGENT_EFFORT_SUPPORTED_TYPES as readonly AgentType[]).includes(agentType)
}

export const AGENT_PERMISSIONS = ['read-only', 'safe-edit', 'yolo'] as const

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

export function isAgentPermission(value: unknown): value is AgentPermission {
  return typeof value === 'string' && (AGENT_PERMISSIONS as readonly string[]).includes(value)
}

export const DEFAULT_AGENT_PERMISSION: AgentPermission = 'safe-edit'

const PERMISSION_FLAGS: Record<AgentType, Record<AgentPermission, readonly string[]>> = {
  codex: {
    'read-only': ['-s', 'read-only'],
    'safe-edit': ['-s', 'workspace-write', '-c', 'approval_policy=never'],
    yolo: ['--dangerously-bypass-approvals-and-sandbox'],
  },
  claude: {
    'read-only': ['--permission-mode', 'plan'],
    'safe-edit': ['--permission-mode', 'acceptEdits'],
    yolo: ['--dangerously-skip-permissions'],
  },
  glm: {
    'read-only': ['--permission-mode', 'plan'],
    'safe-edit': ['--permission-mode', 'acceptEdits'],
    yolo: ['--dangerously-skip-permissions'],
  },
  kimi: {
    'read-only': ['--permission-mode', 'plan'],
    'safe-edit': ['--permission-mode', 'acceptEdits'],
    yolo: ['--dangerously-skip-permissions'],
  },
  gemini: {
    'read-only': ['--approval-mode', 'plan'],
    'safe-edit': ['--approval-mode', 'auto_edit'],
    yolo: ['-y'],
  },
  cursor: {
    // Cursor's execution mode and shell sandbox are independent controls.
    'read-only': ['--mode', 'plan', '--sandbox', 'enabled'],
    'safe-edit': ['--trust', '--sandbox', 'enabled'],
    yolo: ['-f', '--trust'],
  },
  // Grok's --permission-mode enforces only bypassPermissions via the flag, so
  // the level is enforced by the kernel --sandbox profile (always explicit).
  grok: {
    'read-only': ['--permission-mode', 'bypassPermissions', '--sandbox', 'read-only'],
    'safe-edit': ['--permission-mode', 'bypassPermissions', '--sandbox', 'workspace'],
    yolo: ['--permission-mode', 'bypassPermissions', '--sandbox', 'off'],
  },
  antigravity: {
    'read-only': ['--mode', 'plan', '--sandbox'],
    'safe-edit': ['--mode', 'accept-edits', '--sandbox'],
    yolo: ['--dangerously-skip-permissions'],
  },
  // OpenCode permissions are supplied through OPENCODE_PERMISSION.
  opencode: {
    'read-only': [],
    'safe-edit': [],
    yolo: [],
  },
  'command-code': {
    'read-only': ['--permission-mode', 'plan'],
    'safe-edit': ['--yolo', '--permission-mode', 'auto-accept'],
    yolo: ['--yolo'],
  },
}

const OPENCODE_PERMISSION_MAPPING: Record<AgentPermission, object | 'allow'> = {
  'read-only': {
    edit: 'deny',
    bash: 'deny',
    task: 'deny',
    external_directory: 'deny',
    question: 'deny',
  },
  'safe-edit': {
    edit: 'allow',
    bash: 'allow',
    task: 'deny',
    external_directory: 'deny',
    question: 'deny',
  },
  yolo: 'allow',
}

export function createExecutionConfig(
  agentType: AgentType,
  overrides?: Partial<Omit<ExecutionConfig, 'agentType'>>
): ExecutionConfig {
  // permission is applied via `??` rather than letting the spread overwrite the
  // default, so a caller passing `{ permission: undefined }` (e.g. via a mock
  // that bypasses TS) does not silently disable approval handling.
  return {
    executionTimeout: DEFAULT_EXECUTION_TIMEOUT,
    maxOutputBytes: MAX_CAPTURED_OUTPUT_BYTES,
    ...overrides,
    permission: overrides?.permission ?? DEFAULT_AGENT_PERMISSION,
    agentType,
  }
}

export class AgentExecutor {
  private readonly config: ExecutionConfig
  private readonly logger: Logger

  constructor(config: ExecutionConfig, logger?: Logger) {
    this.config = config
    this.logger = logger || new Logger((process.env['LOG_LEVEL'] as LogLevel) || 'info')
  }

  async executeAgent(params: ExecutionParams): Promise<AgentExecutionResult> {
    if (!params?.agent || !params.prompt) {
      const error = 'Invalid execution parameters: agent and prompt are required'
      this.logger.error('Agent execution failed during validation', undefined, { error, params })
      throw new Error(error)
    }

    if (params.agent.length === 0 || params.prompt.length === 0) {
      const error = 'Invalid execution parameters: agent and prompt cannot be empty'
      this.logger.error('Agent execution failed during validation', undefined, { error, params })
      throw new Error(error)
    }

    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Starting agent execution', {
      requestId,
      agent: params.agent,
      promptLength: params.prompt.length,
      cwd: params.cwd,
      extraArgs: params.extra_args?.length || 0,
    })

    try {
      // Add minimal delay to ensure execution time is measurable
      await new Promise((resolve) => setTimeout(resolve, 1))
      const result = await this.executeWithSpawn(params)

      const executionTime = Date.now() - startTime

      this.logger.info('Agent execution completed', {
        requestId,
        exitCode: result.exitCode,
        executionTime,
        hasResult: result.hasResult,
      })

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime,
        ...(result.hasResult !== undefined && { hasResult: result.hasResult }),
        ...(result.resultJson !== undefined && { resultJson: result.resultJson }),
      }
    } catch (error) {
      const executionTime = Date.now() - startTime

      this.logger.error('Agent execution failed', error instanceof Error ? error : undefined, {
        requestId,
        executionTime,
      })

      if (
        error instanceof Error &&
        (error.message.includes('enhance') || error.message.includes('Enhancement'))
      ) {
        throw error
      }

      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown execution error',
        exitCode: 1,
        executionTime,
        hasResult: false,
        resultJson: undefined,
      }
    }
  }

  private buildCommandArgs(params: ExecutionParams): {
    command: string
    args: string[]
    envOverrides: EnvOverrides
  } {
    const envOverrides = this.buildSettingsPathEnv()

    switch (this.config.agentType) {
      case 'codex':
        return this.buildCodexArgs(params, envOverrides)
      case 'claude':
        return this.buildClaudeArgs(params, envOverrides)
      case 'glm':
        return this.buildGlmArgs(params, envOverrides)
      case 'kimi':
        return this.buildKimiArgs(params, envOverrides)
      case 'gemini':
        return this.buildGeminiArgs(params, envOverrides)
      case 'cursor':
        return this.buildCursorArgs(params, envOverrides)
      case 'grok':
        return this.buildGrokArgs(params, envOverrides)
      case 'antigravity':
        return this.buildAntigravityArgs(params, envOverrides)
      case 'opencode':
        return this.buildOpenCodeArgs(params, envOverrides)
      case 'command-code':
        return this.buildCommandCodeArgs(params, envOverrides)
    }
  }

  private buildSettingsPathEnv(): EnvOverrides {
    const env: EnvOverrides = {}
    if (!this.config.agentsSettingsPath) return env
    switch (this.config.agentType) {
      case 'cursor':
        env['CURSOR_CONFIG_DIR'] = this.config.agentsSettingsPath
        break
      case 'codex':
        env['CODEX_HOME'] = this.config.agentsSettingsPath
        break
      // Claude uses argv; redirected Claude backends avoid Claude settings.
      // Other backends use normal config discovery or do not support this override.
    }
    return env
  }

  private permissionFlags(): readonly string[] {
    return PERMISSION_FLAGS[this.config.agentType][this.config.permission]
  }

  private invocationFlags(): string[] {
    const flags = [...this.permissionFlags()]

    if (this.config.model) {
      flags.push('--model', this.config.model)
    }

    if (!this.config.effort) {
      return flags
    }

    switch (this.config.agentType) {
      case 'codex':
        flags.push('-c', `model_reasoning_effort=${JSON.stringify(this.config.effort)}`)
        break
      case 'claude':
      case 'glm':
      case 'kimi':
      case 'antigravity':
      case 'command-code':
        flags.push('--effort', this.config.effort)
        break
      case 'grok':
        flags.push('--reasoning-effort', this.config.effort)
        break
      case 'opencode':
        flags.push('--variant', this.config.effort)
        break
      case 'cursor':
      case 'gemini':
        throw new Error(
          `AGENT_EFFORT is not supported for AGENT_TYPE=${this.config.agentType}. ` +
            `Supported types: ${AGENT_EFFORT_SUPPORTED_TYPES.join(', ')}.`
        )
    }

    return flags
  }

  private formatSystemUserPrompt(params: ExecutionParams): string {
    return `[System Context]\n${params.agent}\n\n[User Prompt]\n${params.prompt}`
  }

  private buildCodexArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    // System context is concatenated into the user prompt rather than injected
    // via `-c model_instructions_file=...`: that flag fully replaces codex's
    // default system prompt, which removed the built-in tool-use guidance and
    // measurably increased exploration overhead and token usage in our tests.
    // Concatenation keeps codex's defaults intact and matches the cursor path.
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...flags, 'exec', '--json', '--skip-git-repo-check', formattedPrompt]
    return { command: 'codex', args, envOverrides }
  }

  private buildCommandCodeArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [
      ...flags,
      '--output-format',
      'json',
      '--trust',
      '--no-session',
      '--skip-onboarding',
      '-p',
      formattedPrompt,
    ]
    return { command: 'command-code', args, envOverrides }
  }

  private buildClaudeArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const cwd = params.cwd || process.cwd()
    const systemPrompt = `cwd: ${cwd}\n\n${params.agent}`
    const args: string[] = [
      ...flags,
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt',
      systemPrompt,
      '-p',
      params.prompt,
    ]
    if (this.config.agentsSettingsPath) {
      args.push('--settings', this.config.agentsSettingsPath)
    }
    return { command: 'claude', args, envOverrides }
  }

  private buildGlmArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const apiKey = this.config.glmApiKey
    if (!apiKey?.trim()) {
      throw new Error(GLM_MISSING_API_KEY_ERROR)
    }

    return this.buildRedirectedClaudeArgs(
      params,
      envOverrides,
      GLM_BASE_URL,
      apiKey,
      'ANTHROPIC_AUTH_TOKEN'
    )
  }

  private buildKimiArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const apiKey = this.config.kimiApiKey
    if (!apiKey?.trim()) {
      throw new Error(KIMI_MISSING_API_KEY_ERROR)
    }

    return this.buildRedirectedClaudeArgs(
      params,
      envOverrides,
      KIMI_BASE_URL,
      apiKey,
      'ANTHROPIC_API_KEY'
    )
  }

  private buildRedirectedClaudeArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides,
    baseUrl: string,
    apiKey: string,
    credentialEnv: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const cwd = params.cwd || process.cwd()
    const systemPrompt = `cwd: ${cwd}\n\n${params.agent}`
    const args: string[] = [
      ...flags,
      '--output-format',
      'stream-json',
      '--verbose',
      '--system-prompt',
      systemPrompt,
      '-p',
      params.prompt,
    ]

    const redirectedEnv: EnvOverrides = {
      ...envOverrides,
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_AUTH_TOKEN: null,
    }
    redirectedEnv[credentialEnv] = apiKey

    return {
      command: 'claude',
      args,
      envOverrides: redirectedEnv,
    }
  }

  private buildGeminiArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    // --skip-trust is unconditional: headless runs in untrusted folders are
    // refused without it (Gemini downgrades to interactive prompts which
    // deadlock here since we have no stdin).
    if (params.agentFilePath) {
      const args = [...flags, '--skip-trust', '--output-format', 'stream-json', '-p', params.prompt]
      return {
        command: 'gemini',
        args,
        envOverrides: { ...envOverrides, GEMINI_SYSTEM_MD: params.agentFilePath },
      }
    }
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...flags, '--skip-trust', '--output-format', 'stream-json', '-p', formattedPrompt]
    return { command: 'gemini', args, envOverrides }
  }

  private buildCursorArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...flags, '--output-format', 'json', '-p', formattedPrompt]
    const env: EnvOverrides = { ...envOverrides }
    if (this.config.cursorApiKey) {
      env['CURSOR_API_KEY'] = this.config.cursorApiKey
    }
    return { command: 'cursor-agent', args, envOverrides: env }
  }

  private buildGrokArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const cwd = params.cwd || process.cwd()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [
      ...flags,
      '--cwd',
      cwd,
      '--output-format',
      'json',
      '--verbatim',
      '-p',
      formattedPrompt,
    ]
    return { command: 'grok', args, envOverrides }
  }

  private buildAntigravityArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...flags, '--output-format', 'stream-json', '-p', formattedPrompt]
    return { command: 'agy', args, envOverrides }
  }

  private buildOpenCodeArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const flags = this.invocationFlags()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...flags, 'run', '--format', 'json', '--auto', formattedPrompt]
    return {
      command: 'opencode',
      args,
      envOverrides: {
        ...envOverrides,
        OPENCODE_PERMISSION: JSON.stringify(OPENCODE_PERMISSION_MAPPING[this.config.permission]),
      },
    }
  }

  private buildSpawnEnv(envOverrides: EnvOverrides): NodeJS.ProcessEnv {
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === null) {
        delete spawnEnv[key]
      } else {
        spawnEnv[key] = value
      }
    }
    return spawnEnv
  }

  private async prepareSpawnEnvironment(envOverrides: EnvOverrides): Promise<{
    env: NodeJS.ProcessEnv
    cleanup: () => Promise<void>
  }> {
    if (this.config.agentType !== 'opencode') {
      return { env: this.buildSpawnEnv(envOverrides), cleanup: async () => {} }
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'subagent-opencode-'))
    const dataHome = path.join(tempDir, 'data')
    const stateHome = path.join(tempDir, 'state')
    const isolatedOpenCodeDir = path.join(dataHome, 'opencode')

    try {
      await fs.promises.mkdir(isolatedOpenCodeDir, { recursive: true })
      await fs.promises.mkdir(stateHome, { recursive: true })

      const defaultDataHome =
        process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share')
      const authSource = path.join(defaultDataHome, 'opencode', 'auth.json')
      const authDestination = path.join(isolatedOpenCodeDir, 'auth.json')

      try {
        await fs.promises.copyFile(authSource, authDestination)
      } catch (error) {
        const code = this.errorCode(error)
        if (code !== 'ENOENT') {
          this.logger.warn('Could not copy OpenCode authentication into isolated data home', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return {
        env: this.buildSpawnEnv({
          ...envOverrides,
          XDG_DATA_HOME: dataHome,
          XDG_STATE_HOME: stateHome,
        }),
        cleanup: async () => {
          await fs.promises.rm(tempDir, { recursive: true, force: true })
        },
      }
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  private errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return undefined
    }
    return typeof error.code === 'string' ? error.code : undefined
  }

  private async executeWithSpawn(params: ExecutionParams): Promise<{
    stdout: string
    stderr: string
    exitCode: number
    hasResult?: boolean
    resultJson?: unknown
  }> {
    const { command, args, envOverrides } = this.buildCommandArgs(params)
    const preparedEnvironment = await this.prepareSpawnEnvironment(envOverrides)

    return new Promise((resolve) => {
      this.logger.debug('Executing with spawn', {
        command,
        cwd: params.cwd || process.cwd(),
      })

      let childProcess: ChildProcess
      try {
        childProcess = spawn(command, args, {
          cwd: params.cwd || process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          env: preparedEnvironment.env,
        })
      } catch (error) {
        void preparedEnvironment.cleanup().finally(() => {
          resolve({
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: this.errorCode(error) === 'ENOENT' ? 127 : 1,
            hasResult: false,
          })
        })
        return
      }

      const streamProcessor = new StreamProcessor(this.config.agentType)
      const stdoutParts: string[] = []
      const stderrParts: string[] = []
      let stdoutLineParts: string[] = []
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      let stdoutTruncated = false
      let stderrTruncated = false
      let capturedBytes = 0
      let timedOut = false
      let outputExceeded = false
      let processError: Error | undefined
      let settled = false
      let forceKillTimer: NodeJS.Timeout | undefined

      const executionTimeout = setTimeout(() => {
        timedOut = true
        this.logger.warn('Execution timeout reached', {
          timeout: this.config.executionTimeout,
        })
        requestTermination()
      }, this.config.executionTimeout)

      const clearTimers = () => {
        clearTimeout(executionTimeout)
        if (forceKillTimer) clearTimeout(forceKillTimer)
      }

      const finish = async (code: number | null, signal?: NodeJS.Signals | null) => {
        if (settled) return
        settled = true
        clearTimers()

        if (!stdoutTruncated) {
          const tail = stdoutDecoder.end()
          stdoutParts.push(tail)
          stdoutLineParts.push(tail)
        }
        if (!stderrTruncated) {
          stderrParts.push(stderrDecoder.end())
        }

        const trailingLine = stdoutLineParts.join('')
        if (trailingLine.trim()) {
          streamProcessor.processLine(trailingLine)
        }
        stdoutLineParts = []

        const stdout = stdoutParts.join('')
        const stderr = stderrParts.join('')

        let result = streamProcessor.getResult()
        if (result === null) {
          streamProcessor.processCompleteOutput(stdout)
          result = streamProcessor.getResult()
        }

        let exitCode = code ?? (signal ? 128 + this.signalNumber(signal) : 1)
        if (timedOut) exitCode = 124
        if (outputExceeded || processError)
          exitCode = this.errorCode(processError) === 'ENOENT' ? 127 : 1
        const errors: string[] = []
        if (stderr) errors.push(stderr)
        if (timedOut) errors.push(`Execution timeout: ${this.config.executionTimeout}ms`)
        if (outputExceeded) {
          errors.push(`Sub-agent output exceeded ${this.config.maxOutputBytes} bytes`)
        }
        if (processError && !stderr) errors.push(processError.message)

        try {
          await preparedEnvironment.cleanup()
        } catch (error) {
          this.logger.warn('Failed to clean up per-run environment', {
            error: error instanceof Error ? error.message : String(error),
          })
        }

        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr: errors.join('\n'),
          exitCode,
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
      }

      const requestTermination = () => {
        childProcess.kill('SIGTERM')
        if (forceKillTimer) return
        forceKillTimer = setTimeout(() => {
          childProcess.kill('SIGKILL')
        }, TERMINATION_GRACE_MS)
      }

      const captureChunk = (
        data: Buffer,
        decoder: StringDecoder,
        markTruncated: () => void
      ): string => {
        const remaining = this.config.maxOutputBytes - capturedBytes
        if (remaining <= 0) {
          outputExceeded = true
          markTruncated()
          requestTermination()
          return ''
        }

        const captured = data.length <= remaining ? data : data.subarray(0, remaining)
        capturedBytes += captured.length
        if (captured.length < data.length) {
          outputExceeded = true
          markTruncated()
          requestTermination()
        }
        return decoder.write(captured)
      }

      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = captureChunk(data, stdoutDecoder, () => {
          stdoutTruncated = true
        })
        stdoutParts.push(chunk)

        let chunkOffset = 0
        while (chunkOffset < chunk.length) {
          const newlineIndex = chunk.indexOf('\n', chunkOffset)
          if (newlineIndex < 0) {
            stdoutLineParts.push(chunk.slice(chunkOffset))
            break
          }

          stdoutLineParts.push(chunk.slice(chunkOffset, newlineIndex))
          const line = stdoutLineParts.join('')
          stdoutLineParts = []
          chunkOffset = newlineIndex + 1
          if (streamProcessor.processLine(line)) {
            requestTermination()
            break
          }
        }
      })

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderrParts.push(
          captureChunk(data, stderrDecoder, () => {
            stderrTruncated = true
          })
        )
      })

      childProcess.on('close', (code: number | null, signal?: NodeJS.Signals | null) => {
        void finish(code, signal)
      })

      childProcess.on('error', (error: Error) => {
        processError = error
        void finish(null)
      })
    })
  }

  private signalNumber(signal: NodeJS.Signals): number {
    if (signal === 'SIGTERM') return 15
    if (signal === 'SIGKILL') return 9
    return 1
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }
}
