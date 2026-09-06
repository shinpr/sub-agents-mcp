import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ExecutionParams } from '../types/ExecutionParams.js'
import { toErrorMessage } from '../utils/ErrorHandler.js'
import { isLogLevel, Logger, type LogLevel } from '../utils/Logger.js'
import { StreamProcessor } from './StreamProcessor.js'

/**
 * A machine-readable reason for failures whose remedy is not obvious from the
 * exit code alone, so callers can give the user an actionable next step.
 */
type ExecutionFailureReason = 'argv_too_long'

export interface AgentExecutionResult {
  stdout: string

  stderr: string

  exitCode: number

  executionTime: number

  hasResult?: boolean

  resultJson?: unknown

  failureReason?: ExecutionFailureReason
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
  return typeof value === 'string' && AGENT_TYPES.some((agentType) => agentType === value)
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
  return AGENT_EFFORT_SUPPORTED_TYPES.some((supported) => supported === agentType)
}

export const AGENT_PERMISSIONS = ['read-only', 'safe-edit', 'yolo'] as const

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

export function isAgentPermission(value: unknown): value is AgentPermission {
  return typeof value === 'string' && AGENT_PERMISSIONS.some((permission) => permission === value)
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

/** Reads LOG_LEVEL from the environment, falling back to `info` when unset or invalid. */
function resolveLogLevelFromEnv(): LogLevel {
  const value = process.env['LOG_LEVEL']
  return isLogLevel(value) ? value : 'info'
}

export interface SpawnOutcome {
  stdout: string
  stderr: string
  exitCode: number
  hasResult?: boolean
  resultJson?: unknown
  failureReason?: ExecutionFailureReason
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return typeof error.code === 'string' ? error.code : undefined
}

function signalNumber(signal: NodeJS.Signals): number {
  if (signal === 'SIGTERM') {
    return 15
  }
  if (signal === 'SIGKILL') {
    return 9
  }
  return 1
}

/**
 * Owns the lifecycle of one spawned agent process: output capture with a byte
 * cap, incremental stream parsing, timeout-driven termination, and settlement
 * into a single {@link SpawnOutcome}.
 */
class SpawnSession {
  private readonly streamProcessor: StreamProcessor
  private readonly stdoutParts: string[] = []
  private readonly stderrParts: string[] = []
  private readonly stdoutDecoder = new StringDecoder('utf8')
  private readonly stderrDecoder = new StringDecoder('utf8')
  private stdoutLineParts: string[] = []
  private stdoutTruncated: boolean = false
  private stderrTruncated: boolean = false
  private capturedBytes: number = 0
  private timedOut: boolean = false
  private cancelled: boolean = false
  private outputExceeded: boolean = false
  private processError: Error | undefined
  private settled: boolean = false
  private forceKillTimer: NodeJS.Timeout | undefined
  private executionTimeout: NodeJS.Timeout | undefined

  constructor(
    private readonly childProcess: ChildProcess,
    private readonly config: ExecutionConfig,
    private readonly logger: Logger,
    private readonly cleanup: () => Promise<void>
  ) {
    this.streamProcessor = new StreamProcessor(config.agentType)
  }

  run(cancelSignal?: AbortSignal): Promise<SpawnOutcome> {
    return new Promise<SpawnOutcome>((resolve) => {
      if (cancelSignal) {
        // Reuses the same graceful SIGTERM -> SIGKILL path as a timeout, so a
        // cancelled request cannot leave the CLI running.
        if (cancelSignal.aborted) {
          queueMicrotask(() => this.cancel())
        } else {
          cancelSignal.addEventListener('abort', () => this.cancel(), { once: true })
        }
      }

      const settle = (code: number | null, signal?: NodeJS.Signals | null): void => {
        if (this.settled) {
          return
        }
        this.settled = true
        this.finish(code, signal).then(resolve, (error: unknown) => {
          resolve({
            stdout: '',
            stderr: toErrorMessage(error),
            exitCode: 1,
            hasResult: false,
          })
        })
      }

      this.executionTimeout = setTimeout(() => {
        this.timedOut = true
        this.logger.warn('Execution timeout reached', { timeout: this.config.executionTimeout })
        this.requestTermination()
      }, this.config.executionTimeout)

      this.childProcess.stdout?.on('data', (data: Buffer) => {
        this.consumeStdout(data)
      })

      this.childProcess.stderr?.on('data', (data: Buffer) => {
        this.stderrParts.push(
          this.captureChunk(data, this.stderrDecoder, () => {
            this.stderrTruncated = true
          })
        )
      })

      this.childProcess.on('close', (code: number | null, signal?: NodeJS.Signals | null) => {
        settle(code, signal)
      })

      this.childProcess.on('error', (error: Error) => {
        this.processError = error
        settle(null)
      })
    })
  }

  /**
   * Stops the agent process, whether the client cancelled the request or the
   * server is shutting down. Reuses the graceful SIGTERM -> SIGKILL escalation.
   */
  cancel(): void {
    if (this.settled || this.cancelled) {
      return
    }
    this.cancelled = true
    this.logger.info('Execution cancelled before the agent finished')
    this.requestTermination()
  }

  private clearTimers(): void {
    if (this.executionTimeout) {
      clearTimeout(this.executionTimeout)
    }
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer)
    }
  }

  private requestTermination(): void {
    this.childProcess.kill('SIGTERM')
    if (this.forceKillTimer) {
      return
    }
    this.forceKillTimer = setTimeout(() => {
      this.childProcess.kill('SIGKILL')
    }, TERMINATION_GRACE_MS)
  }

  /**
   * Copies at most the remaining byte budget out of `data`, flagging truncation
   * and terminating the process once the cap is reached.
   */
  private captureChunk(data: Buffer, decoder: StringDecoder, markTruncated: () => void): string {
    const remaining = this.config.maxOutputBytes - this.capturedBytes
    if (remaining <= 0) {
      this.outputExceeded = true
      markTruncated()
      this.requestTermination()
      return ''
    }

    const captured = data.length <= remaining ? data : data.subarray(0, remaining)
    this.capturedBytes += captured.length
    if (captured.length < data.length) {
      this.outputExceeded = true
      markTruncated()
      this.requestTermination()
    }
    return decoder.write(captured)
  }

  private consumeStdout(data: Buffer): void {
    const chunk = this.captureChunk(data, this.stdoutDecoder, () => {
      this.stdoutTruncated = true
    })
    this.stdoutParts.push(chunk)

    let chunkOffset = 0
    while (chunkOffset < chunk.length) {
      const newlineIndex = chunk.indexOf('\n', chunkOffset)
      if (newlineIndex < 0) {
        this.stdoutLineParts.push(chunk.slice(chunkOffset))
        break
      }

      this.stdoutLineParts.push(chunk.slice(chunkOffset, newlineIndex))
      const line = this.stdoutLineParts.join('')
      this.stdoutLineParts = []
      chunkOffset = newlineIndex + 1
      if (this.streamProcessor.processLine(line)) {
        this.requestTermination()
        break
      }
    }
  }

  /** Flushes both decoders and parses any line left without a trailing newline. */
  private flushStreams(): void {
    if (!this.stdoutTruncated) {
      const tail = this.stdoutDecoder.end()
      this.stdoutParts.push(tail)
      this.stdoutLineParts.push(tail)
    }
    if (!this.stderrTruncated) {
      this.stderrParts.push(this.stderrDecoder.end())
    }

    const trailingLine = this.stdoutLineParts.join('')
    if (trailingLine.trim()) {
      this.streamProcessor.processLine(trailingLine)
    }
    this.stdoutLineParts = []
  }

  private resolveExitCode(code: number | null, signal?: NodeJS.Signals | null): number {
    if (this.outputExceeded || this.processError) {
      return errorCode(this.processError) === 'ENOENT' ? 127 : 1
    }
    if (this.timedOut) {
      return 124
    }
    if (this.cancelled) {
      return 130
    }
    return code ?? (signal ? 128 + signalNumber(signal) : 1)
  }

  private collectErrors(stderr: string): string[] {
    const errors: string[] = []
    if (stderr) {
      errors.push(stderr)
    }
    if (this.timedOut) {
      errors.push(`Execution timeout: ${this.config.executionTimeout}ms`)
    }
    if (this.cancelled) {
      errors.push('Execution was cancelled by the client before the agent finished.')
    }
    if (this.outputExceeded) {
      errors.push(`Sub-agent output exceeded ${this.config.maxOutputBytes} bytes`)
    }
    if (this.processError && !stderr) {
      errors.push(this.processError.message)
    }
    return errors
  }

  private async finish(code: number | null, signal?: NodeJS.Signals | null): Promise<SpawnOutcome> {
    this.clearTimers()
    this.flushStreams()

    const stdout = this.stdoutParts.join('')
    const stderr = this.stderrParts.join('')

    let result = this.streamProcessor.getResult()
    if (result === null) {
      this.streamProcessor.processCompleteOutput(stdout)
      result = this.streamProcessor.getResult()
    }

    await this.cleanup()

    return {
      stdout: result ? JSON.stringify(result) : stdout,
      stderr: this.collectErrors(stderr).join('\n'),
      exitCode: this.resolveExitCode(code, signal),
      hasResult: result !== null,
      resultJson: result !== null ? result : undefined,
    }
  }
}

interface ClaudeRedirectTarget {
  baseUrl: string
  apiKey: string
  credentialEnv: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
}

export class AgentExecutor {
  private readonly config: ExecutionConfig
  private readonly logger: Logger

  constructor(config: ExecutionConfig, logger?: Logger) {
    this.config = config
    this.logger = logger || new Logger(resolveLogLevelFromEnv())
  }

  /**
   * Guards against untrusted callers that bypass the declared parameter type
   * (for example MCP requests deserialized as `unknown`).
   */
  private assertExecutableParams(
    params: ExecutionParams | null | undefined
  ): asserts params is ExecutionParams {
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
  }

  /** Sessions still running, so shutdown does not orphan agent processes. */
  private readonly activeSessions = new Set<SpawnSession>()

  /** Terminates every agent process this executor still has running. */
  terminateAll(): void {
    for (const session of this.activeSessions) {
      session.cancel()
    }
  }

  async executeAgent(params: ExecutionParams, signal?: AbortSignal): Promise<AgentExecutionResult> {
    this.assertExecutableParams(params)

    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Starting agent execution', {
      requestId,
      agent: params.agent,
      promptLength: params.prompt.length,
      cwd: params.cwd,
    })

    try {
      const result = await this.executeWithSpawn(params, signal)

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
        ...(result.failureReason !== undefined && { failureReason: result.failureReason }),
      }
    } catch (error) {
      const executionTime = Date.now() - startTime

      this.logger.error('Agent execution failed', error instanceof Error ? error : undefined, {
        requestId,
        executionTime,
      })

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
    if (!this.config.agentsSettingsPath) {
      return env
    }
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

    return this.buildRedirectedClaudeArgs(params, envOverrides, {
      baseUrl: GLM_BASE_URL,
      apiKey,
      credentialEnv: 'ANTHROPIC_AUTH_TOKEN',
    })
  }

  private buildKimiArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const apiKey = this.config.kimiApiKey
    if (!apiKey?.trim()) {
      throw new Error(KIMI_MISSING_API_KEY_ERROR)
    }

    return this.buildRedirectedClaudeArgs(params, envOverrides, {
      baseUrl: KIMI_BASE_URL,
      apiKey,
      credentialEnv: 'ANTHROPIC_API_KEY',
    })
  }

  private buildRedirectedClaudeArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides,
    redirect: ClaudeRedirectTarget
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const { baseUrl, apiKey, credentialEnv } = redirect
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
      return { env: this.buildSpawnEnv(envOverrides), cleanup: async (): Promise<void> => {} }
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
        const code = errorCode(error)
        if (code !== 'ENOENT') {
          this.logger.warn('Could not copy OpenCode authentication into isolated data home', {
            error: toErrorMessage(error),
          })
        }
      }

      return {
        env: this.buildSpawnEnv({
          ...envOverrides,
          XDG_DATA_HOME: dataHome,
          XDG_STATE_HOME: stateHome,
        }),
        cleanup: async (): Promise<void> => {
          await fs.promises.rm(tempDir, { recursive: true, force: true })
        },
      }
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  private async executeWithSpawn(
    params: ExecutionParams,
    signal?: AbortSignal
  ): Promise<SpawnOutcome> {
    const { command, args, envOverrides } = this.buildCommandArgs(params)
    const preparedEnvironment = await this.prepareSpawnEnvironment(envOverrides)

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
      await this.cleanupQuietly(preparedEnvironment.cleanup)
      if (errorCode(error) === 'E2BIG') {
        const promptBytes = Buffer.byteLength(params.prompt, 'utf8')
        return {
          stdout: '',
          stderr:
            `The prompt is too large to pass to the "${command}" CLI: ` +
            `${promptBytes} bytes exceeds this operating system's argument limit.`,
          exitCode: 1,
          hasResult: false,
          failureReason: 'argv_too_long',
        }
      }
      return {
        stdout: '',
        stderr: toErrorMessage(error),
        exitCode: errorCode(error) === 'ENOENT' ? 127 : 1,
        hasResult: false,
      }
    }

    const session = new SpawnSession(childProcess, this.config, this.logger, () =>
      this.cleanupQuietly(preparedEnvironment.cleanup)
    )
    this.activeSessions.add(session)
    try {
      return await session.run(signal)
    } finally {
      this.activeSessions.delete(session)
    }
  }

  /** Runs a cleanup callback, logging rather than propagating its failures. */
  private async cleanupQuietly(cleanup: () => Promise<void>): Promise<void> {
    try {
      await cleanup()
    } catch (error) {
      this.logger.warn('Failed to clean up per-run environment', {
        error: toErrorMessage(error),
      })
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }
}
