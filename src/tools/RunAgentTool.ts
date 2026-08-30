import { randomUUID } from 'node:crypto'
import type { AgentManager } from '../agents/AgentManager.js'
import type { AgentExecutionResult, AgentExecutor } from '../execution/AgentExecutor.js'
import { formatSessionHistory } from '../session/SessionHistoryFormatter.js'
import type { SessionManager } from '../session/SessionManager.js'
import type { AgentDefinition } from '../types/AgentDefinition.js'
import type { ExecutionParams } from '../types/ExecutionParams.js'
import { Logger, type LogLevel } from '../utils/Logger.js'

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
  structuredContent?: unknown
  _meta?: {
    session_id: string
  }
}

interface McpResponseData {
  result: string
  session_id?: string
  agent: string
  exit_code: number
  execution_time: number
  status: 'success' | 'partial' | 'error'
  request_id?: string
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
    extra_args: {
      type: 'array'
      items: { type: 'string' }
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
  extra_args?: string[] | undefined
  session_id?: string | undefined
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
      extra_args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional configuration parameters for agent execution (optional)',
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
    const logLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info'
    this.logger = new Logger(logLevel)
  }

  async execute(params: unknown): Promise<McpToolResponse> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Run agent tool execution started', {
      requestId,
      timestamp: new Date().toISOString(),
    })

    if (this.sessionManager) {
      Promise.resolve()
        .then(() => this.sessionManager!.cleanupOldSessions())
        .catch((error) => {
          this.logger.warn('Session cleanup failed (best-effort)', {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }

    try {
      const validatedParams = this.validateParams(params)
      const sessionId =
        validatedParams.session_id || (this.sessionManager ? randomUUID() : undefined)

      this.logger.debug('Parameters validated successfully', {
        requestId,
        agent: validatedParams.agent,
        promptLength: validatedParams.prompt.length,
        cwd: validatedParams.cwd,
        extraArgsCount: validatedParams.extra_args?.length || 0,
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
            await this.getAvailableAgentsList()
          )
        }

        this.logger.debug('Agent found and validated', {
          requestId,
          agentName: agentDefinition.name,
          agentDescription: agentDefinition.description,
        })
      }

      if (this.agentExecutor) {
        const agentContext = agentDefinition?.content ?? validatedParams.agent
        let promptWithHistory = validatedParams.prompt
        if (sessionId && this.sessionManager) {
          try {
            // Session history is partitioned by agent name.
            const sessionData = await this.sessionManager.loadSession(
              sessionId,
              validatedParams.agent
            )
            if (sessionData && sessionData.history.length > 0) {
              const historyMarkdown = formatSessionHistory(sessionData)
              promptWithHistory = `Previous conversation history:\n\n${historyMarkdown}\n\n---\n\nCurrent request:\n${validatedParams.prompt}`

              this.logger.info('Session history loaded and merged', {
                requestId,
                sessionId: sessionId,
                historyEntries: sessionData.history.length,
              })
            } else {
              this.logger.debug('No session history found', {
                requestId,
                sessionId: sessionId,
              })
            }
          } catch (error) {
            this.logger.warn('Failed to load session history', {
              requestId,
              sessionId: sessionId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const executionParams: ExecutionParams = {
          agent: agentContext,
          prompt: promptWithHistory,
          ...(validatedParams.cwd !== undefined && { cwd: validatedParams.cwd }),
          ...(validatedParams.extra_args !== undefined && {
            extra_args: validatedParams.extra_args,
          }),
          ...(agentDefinition?.filePath !== undefined && {
            agentFilePath: agentDefinition.filePath,
          }),
        }

        const result = await this.agentExecutor.executeAgent(executionParams)
        this.updateExecutionStats(validatedParams.agent, result.executionTime)

        this.logger.info('Agent execution completed successfully', {
          requestId,
          agent: validatedParams.agent,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
          totalTime: Date.now() - startTime,
        })

        if (sessionId && this.sessionManager) {
          try {
            const sessionRequest: {
              agent: string
              prompt: string
              cwd?: string
              extra_args?: string[]
            } = {
              agent: validatedParams.agent,
              prompt: validatedParams.prompt,
            }

            if (validatedParams.cwd !== undefined) {
              sessionRequest.cwd = validatedParams.cwd
            }
            if (validatedParams.extra_args !== undefined) {
              sessionRequest.extra_args = validatedParams.extra_args
            }

            await this.sessionManager.saveSession(sessionId, sessionRequest, {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              executionTime: result.executionTime,
            })

            this.logger.info('Session saved successfully', {
              requestId,
              sessionId: sessionId,
            })
          } catch (error) {
            this.logger.warn('Failed to save session', {
              requestId,
              sessionId: sessionId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        return this.formatExecutionResponse(result, validatedParams.agent, requestId, sessionId)
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

    const p = params as Record<string, unknown>

    if (!p['agent'] || typeof p['agent'] !== 'string') {
      throw new Error('Agent parameter is required and must be a string')
    }

    const agentName = p['agent'].trim()
    if (agentName === '') {
      throw new Error('Invalid agent parameter: cannot be empty')
    }

    if (agentName.length > 100) {
      throw new Error('Agent name too long (max 100 characters)')
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      throw new Error(
        'Agent name contains invalid characters (only alphanumeric, underscore, and dash allowed)'
      )
    }

    if (!p['prompt'] || typeof p['prompt'] !== 'string') {
      throw new Error('Prompt parameter is required and must be a string')
    }

    const prompt = p['prompt'].trim()
    if (prompt === '') {
      throw new Error('Invalid prompt parameter: cannot be empty')
    }

    if (prompt.length > 50000) {
      throw new Error('Prompt too long (max 50,000 characters)')
    }

    if (p['cwd'] === undefined || p['cwd'] === null) {
      throw new Error('CWD parameter is required')
    }

    if (typeof p['cwd'] !== 'string') {
      throw new Error('CWD parameter must be a string')
    }

    const cwd = p['cwd'].trim()
    if (cwd === '') {
      throw new Error('CWD parameter cannot be empty')
    }

    if (cwd.length > 1000) {
      throw new Error('Working directory path too long (max 1000 characters)')
    }

    if (cwd.includes('..') || cwd.includes('\0')) {
      throw new Error('Invalid working directory path')
    }

    if (p['extra_args'] !== undefined) {
      if (!Array.isArray(p['extra_args'])) {
        throw new Error('Extra args parameter must be an array if provided')
      }

      if (p['extra_args'].length > 20) {
        throw new Error('Too many extra arguments (max 20 allowed)')
      }

      for (const [index, arg] of p['extra_args'].entries()) {
        if (typeof arg !== 'string') {
          throw new Error(`Extra argument at index ${index} must be a string`)
        }

        if (arg.length > 1000) {
          throw new Error(`Extra argument at index ${index} too long (max 1000 characters)`)
        }
      }
    }

    if (p['session_id'] !== undefined) {
      if (typeof p['session_id'] !== 'string') {
        throw new Error('Session ID parameter must be a string if provided')
      }

      const sessionId = p['session_id'].trim()
      if (sessionId === '') {
        throw new Error('Invalid session ID parameter: cannot be empty')
      }

      if (sessionId.length > 100) {
        throw new Error('Session ID too long (max 100 characters)')
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
        throw new Error(
          'Session ID contains invalid characters (only alphanumeric, underscore, and dash allowed)'
        )
      }
    }

    return {
      agent: agentName,
      prompt: prompt,
      cwd: cwd,
      extra_args: p['extra_args'] as string[] | undefined,
      session_id: p['session_id'] as string | undefined,
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private isStringField(value: unknown): value is string {
    return typeof value === 'string'
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
    agentName: string,
    requestId?: string,
    sessionId?: string
  ): McpToolResponse {
    const isError = this.isAgentError(result.resultJson, result.exitCode)
    const contentText = this.extractAgentContent(
      result.resultJson,
      isError,
      result.stdout,
      result.stderr
    )

    const isPartialSuccess =
      this.isPartialResult(result.resultJson) ||
      (result.exitCode === TIMEOUT_EXIT_CODE && result.hasResult === true)

    const isSuccess =
      (!isError && !isPartialSuccess && result.exitCode === 0) || // Normal completion
      (!isError &&
        !isPartialSuccess &&
        (result.exitCode === SIGTERM_EXIT_CODE || result.exitCode === SIGKILL_EXIT_CODE) &&
        result.hasResult === true) // Terminated after receiving a result

    const responseData: McpResponseData = {
      result: contentText,
      agent: agentName,
      exit_code: result.exitCode,
      execution_time: result.executionTime,
      status: isError ? 'error' : isSuccess ? 'success' : isPartialSuccess ? 'partial' : 'error',
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
    availableAgents: string[] | null
  ): McpToolResponse {
    const errorData: Record<string, unknown> = {
      status: 'error',
      error: errorMessage,
      ...(availableAgents && { available_agents: availableAgents }),
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
