import { randomUUID } from 'node:crypto'
import type { AgentManager } from '../agents/AgentManager.js'
import { AGENT_NAME_PATTERN, agentNameProblem } from '../agents/AgentName.js'
import type { AgentExecutionResult, AgentExecutor } from '../execution/AgentExecutor.js'
import { formatSessionHistory } from '../session/SessionHistoryFormatter.js'
import type { SessionManager } from '../session/SessionManager.js'
import type { AgentDefinition } from '../types/AgentDefinition.js'
import type { ExecutionParams } from '../types/ExecutionParams.js'
import { toErrorMessage } from '../utils/ErrorHandler.js'
import { isLogLevel, Logger, type LogLevel } from '../utils/Logger.js'

const COMMAND_CODE_MAX_TURNS_EXIT_CODE = 8
const TIMEOUT_EXIT_CODE = 124
const SIGKILL_EXIT_CODE = 137
const SIGTERM_EXIT_CODE = 143

interface McpTextContent {
  [x: string]: unknown
  type: 'text'
  text: string
}

interface McpToolResponse {
  [x: string]: unknown
  content: McpTextContent[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
  _meta?: {
    session_id: string
  }
}

interface McpResponseData {
  [x: string]: unknown
  result: string
  session_id?: string
  agent: string
  exit_code: number
  execution_time: number
  status: 'success' | 'partial' | 'error'
  request_id?: string

  /** Present only when a session was in use and the history could not be stored. */
  session_saved?: false
}

interface RunAgentInputSchema {
  [x: string]: unknown
  type: 'object'
  properties: {
    [x: string]: object
    agent: {
      type: 'string'
      description: string
    }
    prompt: {
      type: 'string'
      description: string
    }
    cwd: {
      type: 'string'
      description: string
    }
    session_id: {
      type: 'string'
      description: string
    }
  }
  required: string[]
}

interface RunAgentParams {
  agent: string
  prompt: string
  cwd: string
  session_id?: string | undefined
}

const MAX_PROMPT_LENGTH = 50000
const MAX_CWD_LENGTH = 1000
const MAX_SESSION_ID_LENGTH = 100

function validateAgentName(value: unknown): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Agent parameter is required and must be a string')
  }

  const agentName = value.trim()
  const problem = agentNameProblem(agentName)
  if (problem) {
    throw new Error(`Invalid agent parameter: ${problem}`)
  }
  return agentName
}

function validatePrompt(value: unknown): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Prompt parameter is required and must be a string')
  }

  const prompt = value.trim()
  if (prompt === '') {
    throw new Error('Invalid prompt parameter: cannot be empty')
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error('Prompt too long (max 50,000 characters)')
  }
  return prompt
}

function validateCwd(value: unknown): string {
  if (value === undefined || value === null) {
    throw new Error('CWD parameter is required')
  }
  if (typeof value !== 'string') {
    throw new Error('CWD parameter must be a string')
  }

  const cwd = value.trim()
  if (cwd === '') {
    throw new Error('CWD parameter cannot be empty')
  }
  if (cwd.length > MAX_CWD_LENGTH) {
    throw new Error('Working directory path too long (max 1000 characters)')
  }
  if (cwd.includes('..') || cwd.includes('\0')) {
    throw new Error('Invalid working directory path')
  }
  return cwd
}

function validateSessionId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error('Session ID parameter must be a string if provided')
  }

  const sessionId = value.trim()
  if (sessionId === '') {
    throw new Error('Invalid session ID parameter: cannot be empty')
  }
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error('Session ID too long (max 100 characters)')
  }
  if (!AGENT_NAME_PATTERN.test(sessionId)) {
    throw new Error(
      'Session ID contains invalid characters (only alphanumeric, underscore, and dash allowed)'
    )
  }
  return value
}

export class RunAgentTool {
  public readonly name = 'run_agent'
  public readonly description =
    'Delegate complex, multi-step, or specialized tasks to an autonomous agent for independent execution with dedicated context (e.g., refactoring across multiple files, fixing all test failures, systematic codebase analysis, batch operations). Returns session_id in response metadata - reuse it in subsequent calls to maintain conversation context continuity across multiple agent executions.'
  private logger: Logger
  private executionStats: Map<string, { count: number; totalTime: number; lastUsed: Date }> =
    new Map()

  public readonly inputSchema: RunAgentInputSchema = {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Agent name exactly as listed in list_agents resource.',
      },
      prompt: {
        type: 'string',
        description:
          "User's direct request content. Agent context is separately provided via agent parameter.",
      },
      cwd: {
        type: 'string',
        description:
          'Working directory path for agent execution context. Must be an absolute path to a valid directory.',
      },
      session_id: {
        type: 'string',
        description:
          'Session ID for continuing previous conversation context (optional). If omitted, a new session will be auto-generated and returned in response metadata. Reuse the returned session_id in subsequent calls to maintain context continuity.',
      },
    },
    required: ['agent', 'prompt', 'cwd'],
  }

  constructor(
    private agentExecutor?: AgentExecutor,
    private agentManager?: AgentManager,
    private sessionManager?: SessionManager
  ) {
    const envLogLevel = process.env['LOG_LEVEL']
    const logLevel: LogLevel = isLogLevel(envLogLevel) ? envLogLevel : 'info'
    this.logger = new Logger(logLevel)
  }

  /** Prunes expired session files without blocking the current request. */
  private startBackgroundSessionCleanup(requestId: string): void {
    const sessionManager = this.sessionManager
    if (!sessionManager) {
      return
    }

    Promise.resolve()
      .then(() => sessionManager.cleanupOldSessions())
      .catch((error: unknown) => {
        this.logger.warn('Session cleanup failed (best-effort)', {
          requestId,
          error: toErrorMessage(error),
        })
      })
  }

  /**
   * Prefixes the request with the stored conversation history when a session is
   * active. History retrieval is best-effort: failures fall back to the raw prompt.
   */
  private async buildPromptWithHistory(
    validatedParams: RunAgentParams,
    sessionId: string | undefined,
    requestId: string
  ): Promise<string> {
    if (!sessionId || !this.sessionManager) {
      return validatedParams.prompt
    }

    try {
      // Session history is partitioned by agent name.
      const sessionData = await this.sessionManager.loadSession(sessionId, validatedParams.agent)
      if (!sessionData || sessionData.history.length === 0) {
        this.logger.debug('No session history found', { requestId, sessionId })
        return validatedParams.prompt
      }

      const historyMarkdown = formatSessionHistory(sessionData)
      this.logger.info('Session history loaded and merged', {
        requestId,
        sessionId,
        historyEntries: sessionData.history.length,
      })
      return `Previous conversation history:\n\n${historyMarkdown}\n\n---\n\nCurrent request:\n${validatedParams.prompt}`
    } catch (error) {
      this.logger.warn('Failed to load session history', {
        requestId,
        sessionId,
        error: toErrorMessage(error),
      })
      return validatedParams.prompt
    }
  }

  /**
   * Appends the exchange to the session store. Never throws; returns whether the
   * history was actually persisted so the caller can say so in its response.
   */
  private async persistSession(
    validatedParams: RunAgentParams,
    sessionId: string | undefined,
    requestId: string,
    result: AgentExecutionResult
  ): Promise<boolean> {
    if (!sessionId || !this.sessionManager) {
      return false
    }

    try {
      const sessionRequest: {
        agent: string
        prompt: string
        cwd?: string
      } = {
        agent: validatedParams.agent,
        prompt: validatedParams.prompt,
        cwd: validatedParams.cwd,
      }

      const saveResult = await this.sessionManager.saveSession(sessionId, sessionRequest, {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
      })

      if (!saveResult.saved) {
        this.logger.warn('Failed to save session', {
          requestId,
          sessionId,
          error: saveResult.reason,
        })
        return false
      }

      this.logger.info('Session saved successfully', { requestId, sessionId })
      return true
    } catch (error) {
      this.logger.warn('Failed to save session', {
        requestId,
        sessionId,
        error: toErrorMessage(error),
      })
      return false
    }
  }

  /** Runs the agent and records the exchange, returning the formatted MCP response. */
  private async runAgent(
    agentExecutor: AgentExecutor,
    context: {
      validatedParams: RunAgentParams
      agentDefinition: AgentDefinition | undefined
      sessionId: string | undefined
      requestId: string
      startTime: number
      signal?: AbortSignal | undefined
    }
  ): Promise<McpToolResponse> {
    const { validatedParams, agentDefinition, sessionId, requestId, startTime, signal } = context

    const executionParams: ExecutionParams = {
      agent: agentDefinition?.content ?? validatedParams.agent,
      prompt: await this.buildPromptWithHistory(validatedParams, sessionId, requestId),
      cwd: validatedParams.cwd,
      ...(agentDefinition?.filePath !== undefined && {
        agentFilePath: agentDefinition.filePath,
      }),
    }

    const result = await agentExecutor.executeAgent(executionParams, signal)
    this.updateExecutionStats(validatedParams.agent, result.executionTime)

    this.logger.info('Agent execution completed successfully', {
      requestId,
      agent: validatedParams.agent,
      exitCode: result.exitCode,
      executionTime: result.executionTime,
      totalTime: Date.now() - startTime,
    })

    const sessionSaved = await this.persistSession(validatedParams, sessionId, requestId, result)

    return this.formatExecutionResponse(result, {
      agentName: validatedParams.agent,
      requestId,
      sessionId,
      sessionSaved,
    })
  }

  /**
   * Without a session store nothing is persisted, so no session_id is issued —
   * echoing one back would invite the caller to reuse an id that continues nothing.
   */
  private resolveSessionId(validatedParams: RunAgentParams, requestId: string): string | undefined {
    if (!this.sessionManager) {
      if (validatedParams.session_id !== undefined) {
        this.logger.warn('session_id was provided but session management is disabled', {
          requestId,
          requestedSessionId: validatedParams.session_id,
        })
      }
      return undefined
    }
    return validatedParams.session_id || randomUUID()
  }

  async execute(params: unknown, signal?: AbortSignal): Promise<McpToolResponse> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Run agent tool execution started', {
      requestId,
      timestamp: new Date().toISOString(),
    })

    this.startBackgroundSessionCleanup(requestId)

    try {
      const validatedParams = this.validateParams(params)
      // Without a session store nothing is persisted, so echoing a session_id back
      // would invite the caller to reuse an id that continues nothing.
      const sessionId = this.resolveSessionId(validatedParams, requestId)

      this.logger.debug('Parameters validated successfully', {
        requestId,
        agent: validatedParams.agent,
        promptLength: validatedParams.prompt.length,
        cwd: validatedParams.cwd,
        sessionId: sessionId,
        sessionIdGenerated: !validatedParams.session_id && !!sessionId,
      })

      let agentDefinition: AgentDefinition | undefined
      if (this.agentManager) {
        agentDefinition = await this.agentManager.getAgent(validatedParams.agent)
        if (!agentDefinition) {
          this.logger.warn('Agent not found', {
            requestId,
            requestedAgent: validatedParams.agent,
          })

          return this.createErrorResponse(
            `Agent '${validatedParams.agent}' not found`,
            await this.getAvailableAgentsList(),
            this.agentManager.getSkippedDefinitions()
          )
        }

        this.logger.debug('Agent found and validated', {
          requestId,
          agentName: agentDefinition.name,
          agentDescription: agentDefinition.description,
        })
      }

      const agentExecutor = this.agentExecutor
      if (agentExecutor) {
        return await this.runAgent(agentExecutor, {
          validatedParams,
          agentDefinition,
          sessionId,
          requestId,
          startTime,
          signal,
        })
      }

      this.logger.warn('Agent executor not available', { requestId })
      return {
        content: [
          {
            type: 'text',
            text: `Agent execution request received for '${validatedParams.agent}' with prompt: "${validatedParams.prompt}"\n\nNote: Agent executor not initialized.`,
          },
        ],
      }
    } catch (error) {
      const totalTime = Date.now() - startTime

      this.logger.error('Agent execution failed', error instanceof Error ? error : undefined, {
        requestId,
        totalTime,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      })

      return this.createErrorResponse(
        `Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        null
      )
    }
  }

  private validateParams(params: unknown): RunAgentParams {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters: expected object')
    }

    const p: Record<string, unknown> = { ...params }

    return {
      agent: validateAgentName(p['agent']),
      prompt: validatePrompt(p['prompt']),
      cwd: validateCwd(p['cwd']),
      session_id: validateSessionId(p['session_id']),
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private isStringField(value: unknown): value is string {
    return typeof value === 'string'
  }

  /**
   * Derives the single execution outcome that both `status` and `isError` are
   * built from. Keeping one derivation prevents the two fields from disagreeing.
   */
  private resolveOutcome(result: AgentExecutionResult): McpResponseData['status'] {
    if (this.isAgentError(result.resultJson, result.exitCode)) {
      return 'error'
    }

    const isPartial =
      this.isPartialResult(result.resultJson) ||
      (result.exitCode === TIMEOUT_EXIT_CODE && result.hasResult === true)

    if (!isPartial) {
      if (result.exitCode === 0) {
        return 'success'
      }
      // Terminated by a signal, but only after a structured result arrived.
      if (
        (result.exitCode === SIGTERM_EXIT_CODE || result.exitCode === SIGKILL_EXIT_CODE) &&
        result.hasResult === true
      ) {
        return 'success'
      }
    }

    return isPartial ? 'partial' : 'error'
  }

  /**
   * Builds the text shown to the caller. On a non-success outcome the failure
   * reason on stderr must survive even when the agent also produced stdout,
   * otherwise the caller sees partial output and no explanation.
   */
  private buildResultText(
    outcome: McpResponseData['status'],
    result: AgentExecutionResult,
    sessionId: string | undefined
  ): string {
    const content = this.extractAgentContent(
      result.resultJson,
      outcome === 'error',
      result.stdout,
      result.stderr
    )

    // A partial outcome carries a coherent agent result, and `status`/`exit_code`
    // already say it was cut short. Only a failure needs its reason spelled out.
    if (outcome !== 'error') {
      return content
    }

    const notes: string[] = []
    if (result.stderr && !content.includes(result.stderr)) {
      notes.push(result.stderr)
    }
    if (result.failureReason === 'argv_too_long' && sessionId) {
      notes.push(
        `The conversation history stored for session "${sessionId}" is replayed with every ` +
          'call, and it has grown past what the CLI accepts. Start a new session by calling ' +
          'run_agent without session_id.'
      )
    }

    return notes.length > 0 ? [content, ...notes].join('\n\n') : content
  }

  private extractAgentContent(
    resultJson: unknown,
    isError: boolean,
    stdout: string,
    stderr: string
  ): string {
    if (!this.isRecord(resultJson)) {
      return stdout || stderr || 'No output'
    }

    const primaryField = isError ? 'error' : 'result'
    if (this.isStringField(resultJson[primaryField])) {
      return resultJson[primaryField]
    }

    if (this.isStringField(resultJson['content'])) {
      return resultJson['content']
    }

    return stdout || stderr || 'No output'
  }

  private isAgentError(resultJson: unknown, exitCode: number): boolean {
    if (this.isRecord(resultJson) && resultJson['is_error'] === true) {
      return true
    }

    if (
      exitCode === COMMAND_CODE_MAX_TURNS_EXIT_CODE &&
      this.isRecord(resultJson) &&
      resultJson['status'] === 'partial' &&
      resultJson['stop_reason'] === 'max_turns'
    ) {
      return false
    }

    const hasStructuredResult = resultJson !== null && resultJson !== undefined
    return (
      exitCode !== 0 &&
      exitCode !== SIGTERM_EXIT_CODE &&
      exitCode !== TIMEOUT_EXIT_CODE &&
      !(exitCode === SIGKILL_EXIT_CODE && hasStructuredResult)
    )
  }

  private isPartialResult(resultJson: unknown): boolean {
    return this.isRecord(resultJson) && resultJson['status'] === 'partial'
  }

  private formatExecutionResponse(
    result: AgentExecutionResult,
    context: {
      agentName: string
      requestId?: string | undefined
      sessionId?: string | undefined
      sessionSaved?: boolean | undefined
    }
  ): McpToolResponse {
    const { agentName, requestId, sessionId, sessionSaved } = context
    const outcome = this.resolveOutcome(result)
    const isError = outcome === 'error'
    let contentText = this.buildResultText(outcome, result, sessionId)

    // The agent's own result still stands, but a caller told to reuse session_id
    // has to know the history behind it was not written.
    const historyLost = sessionId !== undefined && sessionSaved === false
    if (historyLost) {
      contentText = `${contentText}\n\nThis exchange was not saved to session "${sessionId}", so it will not be part of the history on the next call.`
    }

    const responseData: McpResponseData = {
      result: contentText,
      ...(historyLost && { session_saved: false }),
      agent: agentName,
      exit_code: result.exitCode,
      execution_time: result.executionTime,
      status: outcome,
      ...(sessionId && { session_id: sessionId }),
      ...(requestId && { request_id: requestId }),
    }

    const response: McpToolResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify(responseData, null, 2),
        },
      ],
      isError: isError,
      structuredContent: responseData,
    }

    if (sessionId) {
      response._meta = {
        session_id: sessionId,
      }
    }

    return response
  }

  private createErrorResponse(
    errorMessage: string,
    availableAgents: string[] | null,
    skippedDefinitions: { file: string; reason: string }[] = []
  ): McpToolResponse {
    const errorData: Record<string, unknown> = {
      status: 'error',
      error: errorMessage,
      ...(availableAgents && { available_agents: availableAgents }),
      // Explains "the file exists but the agent is missing" without a log dive.
      ...(skippedDefinitions.length > 0 && { skipped_definitions: skippedDefinitions }),
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(errorData, null, 2),
        },
      ],
      isError: true,
      structuredContent: errorData,
    }
  }

  private generateRequestId(): string {
    return `run_agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private updateExecutionStats(agentName: string, executionTime: number): void {
    const existing = this.executionStats.get(agentName)

    if (existing) {
      existing.count += 1
      existing.totalTime += executionTime
      existing.lastUsed = new Date()
    } else {
      this.executionStats.set(agentName, {
        count: 1,
        totalTime: executionTime,
        lastUsed: new Date(),
      })
    }
  }

  getExecutionStats(): Map<string, { count: number; totalTime: number; lastUsed: Date }> {
    return new Map(this.executionStats)
  }

  private async getAvailableAgentsList(): Promise<string[] | null> {
    if (!this.agentManager) {
      return null
    }

    try {
      const agents = await this.agentManager.listAgents()
      return agents.map((agent) => agent.name)
    } catch (error) {
      this.logger.warn('Failed to get available agents list', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return null
    }
  }
}
