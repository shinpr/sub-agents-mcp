/**
 * RunAgentTool implementation for executing Claude Code sub-agents via MCP
 *
 * Provides the run_agent tool that allows MCP clients to execute specific
 * agents with parameters, integrating with AgentExecutor and AgentManager
 * for complete agent execution workflow.
 */

import type { AgentManager } from 'src/agents/AgentManager'
import type { AgentExecutionResult, AgentExecutor } from 'src/execution/AgentExecutor'
import type { SessionManager } from 'src/session/SessionManager'
import { ToonConverter } from 'src/session/ToonConverter'
import type { ExecutionParams } from 'src/types/ExecutionParams'
import { type LogLevel, Logger } from 'src/utils/Logger'

/**
 * MCP tool content type for text responses
 */
interface McpTextContent {
  type: 'text'
  text: string
}

/**
 * MCP tool response format
 */
interface McpToolResponse {
  content: McpTextContent[]
  isError?: boolean
  structuredContent?: unknown
}

/**
 * Input schema for run_agent tool parameters
 */
interface RunAgentInputSchema {
  [x: string]: unknown
  type: 'object'
  properties: {
    [x: string]: unknown
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

/**
 * Parameters for run_agent tool execution
 */
interface RunAgentParams {
  agent: string
  prompt: string
  cwd?: string | undefined
  extra_args?: string[] | undefined
  /**
   * Session ID for continuing previous conversation context (optional)
   *
   * When provided, the agent will have access to previous request/response history.
   * Must be alphanumeric with hyphens and underscores only (max 100 characters).
   */
  session_id?: string | undefined
}

/**
 * RunAgentTool class implementing the run_agent MCP tool
 *
 * Provides execution of Claude Code sub-agents with parameter validation,
 * error handling, and proper MCP response formatting.
 */
export class RunAgentTool {
  public readonly name = 'run_agent'
  public readonly description =
    'Delegate complex, multi-step, or specialized tasks to an autonomous agent for independent execution with dedicated context (e.g., refactoring across multiple files, fixing all test failures, systematic codebase analysis, batch operations)'
  private logger: Logger
  private executionStats: Map<string, { count: number; totalTime: number; lastUsed: Date }> =
    new Map()

  public readonly inputSchema: RunAgentInputSchema = {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Identifier of the specialized agent to delegate the task to',
      },
      prompt: {
        type: 'string',
        description:
          'Task description or instructions for the agent to execute. When referencing file paths, use absolute paths to ensure proper file access.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory path for agent execution context (optional)',
      },
      extra_args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional configuration parameters for agent execution (optional)',
      },
      session_id: {
        type: 'string',
        description:
          'Session ID for continuing previous conversation context (optional). Enables agents to access previous request/response history.',
      },
    },
    required: ['agent', 'prompt'],
  }

  constructor(
    private agentExecutor?: AgentExecutor,
    private agentManager?: AgentManager,
    private sessionManager?: SessionManager
  ) {
    // Use LOG_LEVEL environment variable if available
    const logLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info'
    this.logger = new Logger(logLevel)
  }

  /**
   * Execute the run_agent tool with the provided parameters
   *
   * @param params - Tool execution parameters
   * @returns Promise resolving to MCP tool response
   * @throws {Error} When parameters are invalid or execution fails
   */
  async execute(params: unknown): Promise<McpToolResponse> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Run agent tool execution started', {
      requestId,
      timestamp: new Date().toISOString(),
    })

    try {
      // Validate parameters with enhanced validation
      const validatedParams = this.validateParams(params)

      this.logger.debug('Parameters validated successfully', {
        requestId,
        agent: validatedParams.agent,
        promptLength: validatedParams.prompt.length,
        cwd: validatedParams.cwd,
        extraArgsCount: validatedParams.extra_args?.length || 0,
        sessionId: validatedParams.session_id,
      })

      // Check if agent exists
      if (this.agentManager) {
        const agent = await this.agentManager.getAgent(validatedParams.agent)
        if (!agent) {
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
          agentName: agent.name,
          agentDescription: agent.description,
        })
      }

      // Execute agent if executor is available
      if (this.agentExecutor) {
        // Report progress: Starting agent execution

        // Get agent definition content if available
        let agentContext = validatedParams.agent
        if (this.agentManager) {
          const agent = await this.agentManager.getAgent(validatedParams.agent)
          if (agent?.content) {
            // Include full agent definition content as system context
            agentContext = agent.content
          }
        }

        // Load session history if session_id is provided and SessionManager is available
        let promptWithHistory = validatedParams.prompt
        if (validatedParams.session_id && this.sessionManager) {
          try {
            const sessionData = await this.sessionManager.loadSession(validatedParams.session_id)
            if (sessionData && sessionData.history.length > 0) {
              // Convert session history to TOON format for token efficiency
              const toonHistory = ToonConverter.convertToToon(sessionData)
              promptWithHistory = `Previous conversation history:\n\n${toonHistory}\n\n---\n\nCurrent request:\n${validatedParams.prompt}`

              this.logger.info('Session history loaded and merged', {
                requestId,
                sessionId: validatedParams.session_id,
                historyEntries: sessionData.history.length,
              })
            } else {
              this.logger.debug('No session history found', {
                requestId,
                sessionId: validatedParams.session_id,
              })
            }
          } catch (error) {
            // Log error but continue - session loading failure should not break main flow
            this.logger.warn('Failed to load session history', {
              requestId,
              sessionId: validatedParams.session_id,
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
        }

        // Report progress: Executing agent

        // Execute agent (this has its own timeout: MCP -> AI)
        const result = await this.agentExecutor.executeAgent(executionParams)

        // Report progress: Execution completed

        // Update execution statistics
        this.updateExecutionStats(validatedParams.agent, result.executionTime)

        this.logger.info('Agent execution completed successfully', {
          requestId,
          agent: validatedParams.agent,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
          totalTime: Date.now() - startTime,
        })

        // Save session if session_id is provided and SessionManager is available
        if (validatedParams.session_id && this.sessionManager) {
          try {
            // Build request object with only defined properties
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

            await this.sessionManager.saveSession(validatedParams.session_id, sessionRequest, {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              executionTime: result.executionTime,
            })

            this.logger.info('Session saved successfully', {
              requestId,
              sessionId: validatedParams.session_id,
            })
          } catch (error) {
            // Log error but continue - session save failure should not break main flow
            this.logger.warn('Failed to save session', {
              requestId,
              sessionId: validatedParams.session_id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        // Mark MCP request as completed

        return this.formatExecutionResponse(
          result,
          validatedParams.agent,
          requestId,
          validatedParams.session_id
        )
      }

      // Fallback response if executor is not available
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

  /**
   * Validate and type-check the input parameters with comprehensive validation
   *
   * @private
   * @param params - Raw parameters to validate
   * @returns Validated parameters
   * @throws {Error} When parameters are invalid
   */
  private validateParams(params: unknown): RunAgentParams {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters: expected object')
    }

    const p = params as Record<string, unknown>

    // Validate required agent parameter with enhanced checks
    if (!p['agent'] || typeof p['agent'] !== 'string') {
      throw new Error('Agent parameter is required and must be a string')
    }

    const agentName = p['agent'].trim()
    if (agentName === '') {
      throw new Error('Invalid agent parameter: cannot be empty')
    }

    // Enhanced agent name validation
    if (agentName.length > 100) {
      throw new Error('Agent name too long (max 100 characters)')
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      throw new Error(
        'Agent name contains invalid characters (only alphanumeric, underscore, and dash allowed)'
      )
    }

    // Validate required prompt parameter with enhanced checks
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

    // Validate optional cwd parameter with path validation
    if (p['cwd'] !== undefined) {
      if (typeof p['cwd'] !== 'string') {
        throw new Error('CWD parameter must be a string if provided')
      }

      if (p['cwd'].length > 1000) {
        throw new Error('Working directory path too long (max 1000 characters)')
      }

      // Basic path security check - prevent obvious malicious paths
      if (p['cwd'].includes('..') || p['cwd'].includes('\0')) {
        throw new Error('Invalid working directory path')
      }
    }

    // Validate optional extra_args parameter with enhanced checks
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

    // Validate optional session_id parameter
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

      // Validate session ID format (alphanumeric, hyphens, underscores only)
      if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
        throw new Error(
          'Session ID contains invalid characters (only alphanumeric, underscore, and dash allowed)'
        )
      }
    }

    return {
      agent: agentName,
      prompt: prompt,
      cwd: p['cwd'] as string | undefined,
      extra_args: p['extra_args'] as string[] | undefined,
      session_id: p['session_id'] as string | undefined,
    }
  }

  /**
   * Format agent execution response
   *
   * @private
   * @param result - Agent execution result
   * @param agentName - Name of the executed agent
   * @param requestId - Request tracking ID
   * @param sessionId - Session ID if session management is used
   * @returns Formatted MCP response
   */
  private formatExecutionResponse(
    result: AgentExecutionResult,
    agentName: string,
    requestId?: string,
    sessionId?: string
  ): McpToolResponse {
    // Determine execution status
    const isSuccess =
      result.exitCode === 0 || // Normal completion
      (result.exitCode === 143 && result.hasResult === true) // SIGTERM with result

    const isPartialSuccess = result.exitCode === 124 && result.hasResult === true // Timeout with partial result
    const isError = !isSuccess && !isPartialSuccess

    // Content is just the agent's actual output
    const contentText = result.stdout || result.stderr || 'No output'

    // All metadata goes to structuredContent
    const structuredContent: Record<string, unknown> = {
      agent: agentName,
      exitCode: result.exitCode,
      executionTime: result.executionTime,
      hasResult: result.hasResult || false,
      status: isSuccess ? 'success' : isPartialSuccess ? 'partial' : 'error',
    }

    if (result.resultJson) {
      structuredContent['result'] = result.resultJson
    }
    if (result.stderr && result.stdout) {
      // Only include stderr in structured content if we also have stdout
      // Otherwise stderr is already in content
      structuredContent['stderr'] = result.stderr
    }
    if (requestId) {
      structuredContent['requestId'] = requestId
    }
    if (sessionId) {
      structuredContent['sessionId'] = sessionId
    }

    // Update statistics
    const stats = this.executionStats.get(agentName)
    if (stats) {
      structuredContent['usageCount'] = stats.count
      structuredContent['averageTime'] = Math.round(stats.totalTime / stats.count)
    }

    return {
      content: [
        {
          type: 'text',
          text: contentText,
        },
      ],
      isError: isError,
      structuredContent,
    }
  }

  /**
   * Create error response with optional available agents list
   *
   * @private
   * @param errorMessage - Error message to display
   * @param availableAgents - Optional list of available agents
   * @returns Error response in MCP format
   */
  private createErrorResponse(
    errorMessage: string,
    availableAgents: string[] | null
  ): McpToolResponse {
    let responseText = `Error: ${errorMessage}`

    if (availableAgents && availableAgents.length > 0) {
      responseText += `\n\nAvailable agents:\n${availableAgents.map((name) => `- ${name}`).join('\n')}`
    }

    const errorStructuredContent: Record<string, unknown> = {
      status: 'error',
      error: errorMessage,
    }

    if (availableAgents) {
      errorStructuredContent['availableAgents'] = availableAgents
    }

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
      isError: true,
      structuredContent: errorStructuredContent,
    }
  }

  /**
   * Generate unique request ID for tracking
   *
   * @private
   * @returns Unique request identifier
   */
  private generateRequestId(): string {
    return `run_agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Update execution statistics
   *
   * @private
   * @param agentName - Name of the executed agent
   * @param executionTime - Time taken for execution
   */
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

  /**
   * Get execution statistics for monitoring
   *
   * @returns Map of agent execution statistics
   */
  getExecutionStats(): Map<string, { count: number; totalTime: number; lastUsed: Date }> {
    return new Map(this.executionStats)
  }

  /**
   * Get list of available agent names
   *
   * @private
   * @returns Promise resolving to array of agent names
   */
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
