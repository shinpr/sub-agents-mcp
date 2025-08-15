/**
 * RunAgentTool implementation for executing Claude Code sub-agents via MCP
 *
 * Provides the run_agent tool that allows MCP clients to execute specific
 * agents with parameters, integrating with AgentExecutor and AgentManager
 * for complete agent execution workflow.
 */

import type { AgentManager } from 'src/agents/AgentManager'
import type { AgentExecutionResult, AgentExecutor } from 'src/execution/AgentExecutor'
import { McpRequestTimeout, type ProgressNotification } from 'src/execution/McpRequestTimeout'
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
}

/**
 * RunAgentTool class implementing the run_agent MCP tool
 *
 * Provides execution of Claude Code sub-agents with parameter validation,
 * error handling, and proper MCP response formatting.
 */
export class RunAgentTool {
  public readonly name = 'run_agent'
  public readonly description = 'Execute a Claude Code sub-agent with specified parameters'
  private logger: Logger
  private readonly mcpTimeout: McpRequestTimeout
  private executionStats: Map<string, { count: number; totalTime: number; lastUsed: Date }> =
    new Map()

  public readonly inputSchema: RunAgentInputSchema = {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Name of the agent to execute',
      },
      prompt: {
        type: 'string',
        description: 'Prompt to send to the agent',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for agent execution',
      },
      extra_args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional command line arguments',
      },
    },
    required: ['agent', 'prompt'],
  }

  constructor(
    private agentExecutor?: AgentExecutor,
    private agentManager?: AgentManager
  ) {
    // Use LOG_LEVEL environment variable if available
    const logLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info'
    this.logger = new Logger(logLevel)

    // Initialize MCP-level timeout management (AI -> MCP)
    // This is separate from AgentExecutor timeout (MCP -> AI)
    // Uses default values from McpRequestTimeout (6min/11min)
    this.mcpTimeout = new McpRequestTimeout(
      {
        progressResetEnabled: true,
        warningThresholdMs: 60000, // 1 minute warning
        enableDebugLogging: logLevel === 'debug',
      },
      this.logger
    )
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

    // Start MCP-level timeout tracking (AI -> MCP)
    this.mcpTimeout.startTimeout(
      requestId,
      (context) => {
        // Handle timeout at MCP level
        this.logger.error('MCP request timeout', undefined, {
          requestId: context.requestId,
          elapsedMs: Date.now() - context.startTime,
          progressCount: context.progressCount,
        })
      },
      (notification: ProgressNotification) => {
        // Send progress notification
        this.logger.info('Progress notification', {
          requestId: notification.requestId,
          message: notification.message,
        })
      }
    )

    try {
      // Validate parameters with enhanced validation
      const validatedParams = this.validateParams(params)

      this.logger.debug('Parameters validated successfully', {
        requestId,
        agent: validatedParams.agent,
        promptLength: validatedParams.prompt.length,
        cwd: validatedParams.cwd,
        extraArgsCount: validatedParams.extra_args?.length || 0,
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
        this.mcpTimeout.reportProgress(requestId, 'Preparing agent execution', 10)

        // Get agent definition content if available
        let agentContext = validatedParams.agent
        if (this.agentManager) {
          const agent = await this.agentManager.getAgent(validatedParams.agent)
          if (agent?.content) {
            // Include full agent definition content as system context
            agentContext = agent.content
          }
        }

        const executionParams: ExecutionParams = {
          agent: agentContext,
          prompt: validatedParams.prompt,
          ...(validatedParams.cwd !== undefined && { cwd: validatedParams.cwd }),
          ...(validatedParams.extra_args !== undefined && {
            extra_args: validatedParams.extra_args,
          }),
        }

        // Report progress: Executing agent
        this.mcpTimeout.reportProgress(requestId, 'Executing agent via CLI', 30)

        // Execute agent (this has its own timeout: MCP -> AI)
        const result = await this.agentExecutor.executeAgent(executionParams)

        // Report progress: Execution completed
        this.mcpTimeout.reportProgress(requestId, 'Processing agent response', 90)

        // Update execution statistics
        this.updateExecutionStats(validatedParams.agent, result.executionTime)

        this.logger.info('Agent execution completed successfully', {
          requestId,
          agent: validatedParams.agent,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
          totalTime: Date.now() - startTime,
        })

        // Mark MCP request as completed
        this.mcpTimeout.complete(requestId)

        return this.formatExecutionResponse(result, validatedParams.agent, requestId)
      }

      // Fallback response if executor is not available
      this.logger.warn('Agent executor not available', { requestId })
      this.mcpTimeout.complete(requestId)
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

      // Check if this was a timeout error
      const isTimeout = this.mcpTimeout.hasTimedOut(requestId)

      if (isTimeout) {
        // Cancel the request at MCP level
        this.mcpTimeout.cancel(requestId, 'MCP request timeout exceeded')

        // Return a user-friendly timeout response
        return this.createErrorResponse(
          'Request processing took too long and was cancelled. This may happen with complex prompts. Please try simplifying your request or breaking it into smaller parts.',
          null
        )
      }

      this.logger.error('Agent execution failed', error instanceof Error ? error : undefined, {
        requestId,
        totalTime,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      })

      // Clear timeout on error
      this.mcpTimeout.clearTimeout(requestId)

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

    return {
      agent: agentName,
      prompt: prompt,
      cwd: p['cwd'] as string | undefined,
      extra_args: p['extra_args'] as string[] | undefined,
    }
  }

  /**
   * Format successful agent execution response with enhanced formatting
   *
   * @private
   * @param result - Agent execution result
   * @param agentName - Name of the executed agent
   * @param requestId - Request tracking ID
   * @returns Formatted MCP response
   */
  private formatExecutionResponse(
    result: AgentExecutionResult,
    agentName: string,
    requestId?: string
  ): McpToolResponse {
    let responseText = '# Agent Execution Result\n\n'
    responseText += `**Agent:** ${agentName}\n`
    responseText += `**Exit Code:** ${result.exitCode}\n`
    responseText += `**Execution Time:** ${result.executionTime}ms\n`
    responseText += `**Method:** ${result.executionMethod}\n`

    if (requestId) {
      responseText += `**Request ID:** ${requestId}\n`
    }

    // Add execution statistics
    const stats = this.executionStats.get(agentName)
    if (stats) {
      responseText += `**Usage Count:** ${stats.count}\n`
      responseText += `**Average Time:** ${Math.round(stats.totalTime / stats.count)}ms\n`
    }

    responseText += '\n---\n\n'

    if (result.stdout) {
      responseText += `## Output\n\n\`\`\`\n${result.stdout}\n\`\`\`\n\n`
    }

    if (result.stderr) {
      responseText += `## Errors/Warnings\n\n\`\`\`\n${result.stderr}\n\`\`\`\n\n`
    }

    if (result.exitCode !== 0) {
      responseText += `⚠️ **Agent execution failed with exit code: ${result.exitCode}**\n`
    } else {
      responseText += '✅ **Agent execution completed successfully**\n'
    }

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
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

    return {
      content: [
        {
          type: 'text',
          text: responseText,
        },
      ],
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
   * Update execution statistics for performance monitoring
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

    // Clean up old statistics (keep only last 100 agents)
    if (this.executionStats.size > 100) {
      const sortedEntries = Array.from(this.executionStats.entries()).sort(
        ([, a], [, b]) => b.lastUsed.getTime() - a.lastUsed.getTime()
      )

      this.executionStats.clear()
      for (const [name, stats] of sortedEntries.slice(0, 100)) {
        this.executionStats.set(name, stats)
      }
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
