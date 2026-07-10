import { type ChildProcess, spawn } from 'node:child_process'
import type { ExecutionParams } from '../types/ExecutionParams.js'
import { Logger, type LogLevel } from '../utils/Logger.js'
import { StreamProcessor } from './StreamProcessor.js'

/**
 * Detailed execution result that includes performance metrics and method information.
 * Captures the agent execution outcome with additional monitoring capabilities.
 */
export interface AgentExecutionResult {
  /**
   * Standard output from the agent execution.
   * Contains the agent's response or execution result.
   */
  stdout: string

  /**
   * Standard error output from the agent execution.
   * Contains error messages and diagnostic information.
   */
  stderr: string

  /**
   * Exit code returned by the agent process.
   * 0 indicates success, non-zero indicates failure.
   */
  exitCode: number

  /**
   * Total execution time in milliseconds.
   * Used for performance monitoring and optimization.
   */
  executionTime: number

  /**
   * Whether a result JSON was successfully obtained from the agent.
   * True when StreamProcessor detects a valid JSON response.
   */
  hasResult?: boolean

  /**
   * The parsed JSON result from the agent if available.
   * Contains the structured response data when hasResult is true.
   */
  resultJson?: unknown
}

/**
 * Simplified execution configuration.
 */
export interface ExecutionConfig {
  /**
   * Maximum execution timeout in milliseconds.
   * Default: 5 minutes (300000ms)
   */
  executionTimeout: number

  /**
   * Type of agent to use for execution.
   * 'cursor', 'claude', 'gemini', 'codex', 'glm', or 'grok'
   */
  agentType: AgentType

  /**
   * Approval/sandbox level the sub-agent runs with.
   *
   * Sub-agents have no stdin, so any approval prompt would deadlock the run.
   * The default 'safe-edit' keeps writes confined to the workspace while
   * suppressing prompts. The default value is owned by ServerConfig and
   * threaded through here; this field is required.
   */
  permission: AgentPermission

  /**
   * Path to CLI settings file/directory.
   * Applied differently based on agentType:
   * - claude: passed as --settings argument
   * - cursor: set as CURSOR_CONFIG_DIR environment variable
   * - codex: set as CODEX_HOME environment variable
   * - gemini: not supported (ignored)
   */
  agentsSettingsPath?: string

  /**
   * API key for cursor-agent authentication.
   * Passed to cursor-agent via CURSOR_API_KEY environment variable.
   */
  cursorApiKey?: string

  /**
   * API key for GLM (Z.ai) authentication.
   * Passed to the claude binary via ANTHROPIC_AUTH_TOKEN environment variable.
   */
  glmApiKey?: string
}

export const DEFAULT_EXECUTION_TIMEOUT = 300000 // 5 minutes

type EnvOverrides = Record<string, string | null>

const GLM_BASE_URL = 'https://api.z.ai/api/anthropic'

const GLM_MISSING_API_KEY_ERROR =
  'GLM backend needs a Z.ai API token in the CLI_API_KEY environment variable. ' +
  'Add CLI_API_KEY to this MCP server environment in your MCP client configuration, ' +
  'then restart or reconnect the MCP server so the running process receives it. ' +
  'This run will keep failing until the MCP process is restarted with CLI_API_KEY set.'

/**
 * Supported agent runtimes. Single source of truth for both runtime validation
 * (ServerConfig) and static typing.
 */
export const AGENT_TYPES = ['cursor', 'claude', 'gemini', 'codex', 'glm', 'grok'] as const

export type AgentType = (typeof AGENT_TYPES)[number]

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && (AGENT_TYPES as readonly string[]).includes(value)
}

/**
 * Supported permission levels. Single source of truth for both runtime
 * validation (ServerConfig) and static typing.
 */
export const AGENT_PERMISSIONS = ['read-only', 'safe-edit', 'yolo'] as const

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

export function isAgentPermission(value: unknown): value is AgentPermission {
  return typeof value === 'string' && (AGENT_PERMISSIONS as readonly string[]).includes(value)
}

/**
 * Default permission level used when AGENT_PERMISSION is not set.
 * Owned here so ServerConfig and createExecutionConfig share a single constant.
 */
export const DEFAULT_AGENT_PERMISSION: AgentPermission = 'safe-edit'

/**
 * Permission level → per-CLI flag mapping.
 *
 * Levels:
 * - 'read-only': investigation/review only, no edits or shell writes.
 * - 'safe-edit' (default): auto-approve edits inside the workspace, suppress prompts.
 * - 'yolo': bypass all approvals and sandboxing.
 *
 * Order is preserved when these flags are spliced into argv; tests assert
 * exact arrays via toEqual, so any change here must be reflected in tests.
 */
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
  gemini: {
    'read-only': ['--approval-mode', 'plan'],
    'safe-edit': ['--approval-mode', 'auto_edit'],
    yolo: ['-y'],
  },
  cursor: {
    'read-only': ['--mode', 'plan'],
    'safe-edit': ['--trust'],
    yolo: ['-f', '--trust'],
  },
  grok: {
    'read-only': ['--permission-mode', 'dontAsk'],
    'safe-edit': ['--permission-mode', 'auto'],
    yolo: ['--permission-mode', 'bypassPermissions'],
  },
}

/**
 * Creates a complete ExecutionConfig with the provided agent type.
 * @param agentType - The type of agent to use
 * @param overrides - Optional overrides for configuration values
 */
export function createExecutionConfig(
  agentType: AgentType,
  overrides?: Partial<Omit<ExecutionConfig, 'agentType'>>
): ExecutionConfig {
  // permission is applied via `??` rather than letting the spread overwrite the
  // default, so a caller passing `{ permission: undefined }` (e.g. via a mock
  // that bypasses TS) does not silently disable approval handling.
  return {
    executionTimeout: DEFAULT_EXECUTION_TIMEOUT,
    ...overrides,
    permission: overrides?.permission ?? DEFAULT_AGENT_PERMISSION,
    agentType,
  }
}

/**
 * AgentExecutor class implements execution strategy for running Claude Code agents.
 * Uses child_process.spawn for proper TTY handling and stdin/stdout streaming.
 * Includes performance monitoring and timeout management.
 */
export class AgentExecutor {
  private readonly config: ExecutionConfig
  private readonly logger: Logger

  /**
   * Creates a new AgentExecutor instance.
   *
   * @param config - Execution configuration including CLI command and thresholds
   * @param logger - Optional Logger instance for structured logging
   */
  constructor(config: ExecutionConfig, logger?: Logger) {
    this.config = config
    // Use provided logger or create new one with LOG_LEVEL env var
    this.logger = logger || new Logger((process.env['LOG_LEVEL'] as LogLevel) || 'info')
  }

  /**
   * Executes an agent with the specified parameters using spawn strategy.
   *
   * This method implements the core execution logic using spawn for proper TTY
   * handling and streaming. It includes comprehensive performance monitoring.
   *
   * @param params - Execution parameters including agent name, prompt, and options
   * @returns Promise resolving to detailed execution result with performance metrics
   * @throws {Error} When agent execution fails or parameters are invalid
   *
   * @example
   * ```typescript
   * const executor = new AgentExecutor()
   * const result = await executor.executeAgent({
   *   agent: "code-helper",
   *   prompt: "Review this code",
   *   cwd: "/project"
   * })
   * console.log(`Execution took ${result.executionTime}ms using ${result.executionMethod}`)
   * ```
   */
  async executeAgent(params: ExecutionParams): Promise<AgentExecutionResult> {
    // Input validation
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

      // Use spawn method for proper TTY handling

      // Execute using spawn for proper TTY handling
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

      // Re-throw enhancement errors
      if (
        error instanceof Error &&
        (error.message.includes('enhance') || error.message.includes('Enhancement'))
      ) {
        throw error
      }

      // Return error result for execution failures
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

  /**
   * Builds CLI-specific command, args, and environment overrides.
   *
   * Each CLI's argv layout follows the pattern: permission flags first
   * (so the per-CLI base flags and the prompt remain at the tail). Per-CLI
   * specifics (system-prompt injection, settings path, API key) are handled
   * by the dedicated builder.
   *
   * @private
   */
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
      case 'gemini':
        return this.buildGeminiArgs(params, envOverrides)
      case 'cursor':
        return this.buildCursorArgs(params, envOverrides)
      case 'grok':
        return this.buildGrokArgs(params, envOverrides)
    }
  }

  /**
   * Maps AGENTS_SETTINGS_PATH onto the per-CLI env var (claude is handled
   * via argv, gemini does not support it). Gemini ignoring this is a known
   * upstream limitation, not a bug here.
   *
   * @private
   */
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
      // claude: handled via --settings argv below
      // glm: uses the claude binary, but intentionally avoids Claude settings.
      // grok: not supported (upstream limitation)
      // gemini: not supported (upstream limitation)
    }
    return env
  }

  private permissionFlags(): readonly string[] {
    return PERMISSION_FLAGS[this.config.agentType][this.config.permission]
  }

  private formatSystemUserPrompt(params: ExecutionParams): string {
    return `[System Context]\n${params.agent}\n\n[User Prompt]\n${params.prompt}`
  }

  private buildCodexArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const perm = this.permissionFlags()
    // System context is concatenated into the user prompt rather than injected
    // via `-c model_instructions_file=...`: that flag fully replaces codex's
    // default system prompt, which removed the built-in tool-use guidance and
    // measurably increased exploration overhead and token usage in our tests.
    // Concatenation keeps codex's defaults intact and matches the cursor path.
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...perm, 'exec', '--json', '--skip-git-repo-check', formattedPrompt]
    return { command: 'codex', args, envOverrides }
  }

  private buildClaudeArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const perm = this.permissionFlags()
    const cwd = params.cwd || process.cwd()
    const systemPrompt = `cwd: ${cwd}\n\n${params.agent}`
    const args: string[] = [
      ...perm,
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

    const perm = this.permissionFlags()
    const cwd = params.cwd || process.cwd()
    const systemPrompt = `cwd: ${cwd}\n\n${params.agent}`
    const args: string[] = [
      ...perm,
      '--output-format',
      'stream-json',
      '--verbose',
      '--system-prompt',
      systemPrompt,
      '-p',
      params.prompt,
    ]

    return {
      command: 'claude',
      args,
      envOverrides: {
        ...envOverrides,
        ANTHROPIC_BASE_URL: GLM_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_API_KEY: null,
      },
    }
  }

  private buildGeminiArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const perm = this.permissionFlags()
    // --skip-trust is unconditional: headless runs in untrusted folders are
    // refused without it (Gemini downgrades to interactive prompts which
    // deadlock here since we have no stdin).
    if (params.agentFilePath) {
      const args = [...perm, '--skip-trust', '--output-format', 'stream-json', '-p', params.prompt]
      return {
        command: 'gemini',
        args,
        envOverrides: { ...envOverrides, GEMINI_SYSTEM_MD: params.agentFilePath },
      }
    }
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...perm, '--skip-trust', '--output-format', 'stream-json', '-p', formattedPrompt]
    return { command: 'gemini', args, envOverrides }
  }

  private buildCursorArgs(
    params: ExecutionParams,
    envOverrides: EnvOverrides
  ): { command: string; args: string[]; envOverrides: EnvOverrides } {
    const perm = this.permissionFlags()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [...perm, '--output-format', 'json', '-p', formattedPrompt]
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
    const perm = this.permissionFlags()
    const cwd = params.cwd || process.cwd()
    const formattedPrompt = this.formatSystemUserPrompt(params)
    const args = [
      ...perm,
      '--cwd',
      cwd,
      '--output-format',
      'json',
      '--always-approve',
      '--verbatim',
      '-p',
      formattedPrompt,
    ]
    return { command: 'grok', args, envOverrides }
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

  /**
   * Executes an agent using child_process.spawn for proper TTY handling.
   *
   * @private
   * @param params - Execution parameters
   * @returns Promise resolving to execution result
   */
  private async executeWithSpawn(params: ExecutionParams): Promise<{
    stdout: string
    stderr: string
    exitCode: number
    hasResult?: boolean
    resultJson?: unknown
  }> {
    return new Promise((resolve) => {
      // Build command, args, and env based on agent type with system prompt separation
      const { command, args, envOverrides } = this.buildCommandArgs(params)

      // Build environment variables for spawn
      const spawnEnv = this.buildSpawnEnv(envOverrides)

      this.logger.debug('Executing with spawn', {
        command,
        cwd: params.cwd || process.cwd(),
      })

      // Spawn process
      const childProcess: ChildProcess = spawn(command, args, {
        cwd: params.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'], // stdin set to 'ignore' as cursor-agent receives prompt via args
        shell: false,
        env: spawnEnv,
      })

      // Initialize stream processor and buffers
      const streamProcessor = new StreamProcessor()
      let stdout = ''
      let stderr = ''
      let stdoutBuffer = ''

      // No need to handle stdin as it's set to 'ignore'
      const executionTimeout = setTimeout(() => {
        this.logger.warn('Execution timeout reached', {
          timeout: this.config.executionTimeout,
        })
        childProcess.kill('SIGTERM')

        // Get any result collected so far
        const result = streamProcessor.getResult()
        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr: stderr || `Execution timeout: ${this.config.executionTimeout}ms`,
          exitCode: 124, // Standard timeout exit code
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
      }, this.config.executionTimeout)

      // Handle stdout stream with simplified processing
      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk
        stdoutBuffer += chunk

        // Process complete lines
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          // Process line returns true when final JSON is detected
          const isComplete = streamProcessor.processLine(line)

          if (isComplete) {
            // Ensure stdout contains the complete JSON result
            const completeResult = streamProcessor.getResult()
            if (completeResult) {
              stdout = JSON.stringify(completeResult)
            }
            // Processing complete, kill the process
            childProcess.kill('SIGTERM')
            break
          }
        }
      })

      // Handle stderr stream
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      childProcess.on('close', (code: number | null) => {
        clearTimeout(executionTimeout)

        // Get the final result JSON
        let result = streamProcessor.getResult()
        if (result === null) {
          streamProcessor.processCompleteOutput(stdout)
          result = streamProcessor.getResult()
        }

        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr,
          exitCode: code || 0,
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
      })

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        clearTimeout(executionTimeout)

        // Get any result collected before error
        const result = streamProcessor.getResult()

        resolve({
          stdout: result ? JSON.stringify(result) : stdout,
          stderr: stderr || error.message,
          exitCode: 1,
          hasResult: result !== null,
          resultJson: result !== null ? result : undefined,
        })
      })
    })
  }

  /**
   * Generates a unique request ID for tracking execution requests.
   *
   * @private
   * @returns Unique request identifier
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }
}
