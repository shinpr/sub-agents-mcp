import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListResourcesRequestSchema,
  type ListResourcesResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  ReadResourceRequestSchema,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { AgentManager } from '../agents/AgentManager.js'
import type { ServerConfig } from '../config/ServerConfig.js'
import { AgentExecutor, createExecutionConfig } from '../execution/AgentExecutor.js'
import { AgentResources } from '../resources/AgentResources.js'
import { SessionManager } from '../session/SessionManager.js'
import { RunAgentTool } from '../tools/RunAgentTool.js'
import { AppError, ValidationError } from '../utils/ErrorHandler.js'
import { Logger, type LogLevel } from '../utils/Logger.js'

interface ServerInfo {
  name: string
  version: string
}

export class McpServer {
  private server: Server
  private transport: StdioServerTransport | null = null
  private config: ServerConfig
  private agentManager: AgentManager
  private agentExecutor: AgentExecutor
  private runAgentTool: RunAgentTool
  private agentResources: AgentResources
  private sessionManager?: SessionManager

  constructor(config: ServerConfig) {
    this.validateConfig(config)
    this.config = config

    this.log('info', 'Initializing MCP server', {
      name: config.serverName,
      version: config.serverVersion,
    })

    this.agentManager = new AgentManager(config)
    const executionConfig = createExecutionConfig(config.agentType, {
      executionTimeout: config.executionTimeoutMs,
      permission: config.agentPermission,
      ...(config.agentModel && { model: config.agentModel }),
      ...(config.agentEffort && { effort: config.agentEffort }),
      ...(config.agentsSettingsPath && { agentsSettingsPath: config.agentsSettingsPath }),
      ...(config.cursorApiKey && { cursorApiKey: config.cursorApiKey }),
      ...(config.glmApiKey && { glmApiKey: config.glmApiKey }),
      ...(config.kimiApiKey && { kimiApiKey: config.kimiApiKey }),
    })

    const executorLogger = new Logger(config.logLevel)

    this.agentExecutor = new AgentExecutor(executionConfig, executorLogger)

    if (config.sessionEnabled) {
      this.sessionManager = new SessionManager({
        enabled: config.sessionEnabled,
        sessionDir: config.sessionDir,
        retentionDays: config.sessionRetentionDays,
      })
      this.log('info', 'Session management enabled', {
        sessionDir: config.sessionDir,
        retentionDays: config.sessionRetentionDays,
      })
    } else {
      this.log('info', 'Session management disabled')
    }

    this.runAgentTool = new RunAgentTool(this.agentExecutor, this.agentManager, this.sessionManager)
    this.agentResources = new AgentResources(this.agentManager)

    this.server = new Server(
      {
        name: config.serverName,
        version: config.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    )

    this.setupTransport()
    this.setupHandlers()

    this.log('info', 'MCP server initialized successfully')
  }

  private validateConfig(config: ServerConfig): void {
    if (!config.serverName || config.serverName.trim() === '') {
      throw new Error('Server name cannot be empty')
    }
    if (!config.serverVersion || config.serverVersion.trim() === '') {
      throw new Error('Server version cannot be empty')
    }
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const logLevels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    }

    if (logLevels[level] >= logLevels[this.config.logLevel]) {
      const timestamp = new Date().toISOString()
      const logEntry = {
        timestamp,
        level,
        message,
        service: 'mcp-server',
        ...metadata,
      }
      console.error(JSON.stringify(logEntry))
    }
  }

  private setupTransport(): void {
    try {
      this.transport = new StdioServerTransport()
      this.log('debug', 'StdioServerTransport configured successfully')
    } catch (error) {
      this.log('error', 'Failed to setup transport', { error: String(error) })
      throw new AppError('Failed to setup MCP transport', 'TRANSPORT_SETUP_FAILED')
    }
  }

  private setupHandlers(): void {
    try {
      this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
        const startTime = Date.now()
        this.log('debug', 'Received list_tools request')

        try {
          const result: ListToolsResult = {
            tools: [
              {
                name: this.runAgentTool.name,
                description: this.runAgentTool.description,
                inputSchema: this.runAgentTool.inputSchema,
              },
            ],
          }

          this.log('debug', 'List tools request completed', {
            responseTime: Date.now() - startTime,
            toolCount: result.tools.length,
          })

          return result
        } catch (error) {
          this.log('error', 'List tools request failed', {
            responseTime: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      })

      this.server.setRequestHandler(
        CallToolRequestSchema,
        async (request): Promise<CallToolResult> => {
          const startTime = Date.now()
          const { params } = request
          this.log('debug', 'Received call_tool request', { tool: params.name })

          try {
            if (params.name === 'run_agent') {
              const result = await this.runAgentTool.execute(params.arguments)

              this.log('info', 'Tool execution completed', {
                tool: params.name,
                responseTime: Date.now() - startTime,
                success: true,
              })

              return result as CallToolResult
            }

            throw new ValidationError(`Unknown tool: ${params.name}`, 'UNKNOWN_TOOL')
          } catch (error) {
            this.log('error', 'Tool execution failed', {
              tool: params.name,
              responseTime: Date.now() - startTime,
              error: error instanceof Error ? error.message : String(error),
            })
            throw error
          }
        }
      )

      this.server.setRequestHandler(
        ListResourcesRequestSchema,
        async (): Promise<ListResourcesResult> => {
          const startTime = Date.now()
          this.log('debug', 'Received list_resources request')

          try {
            const resources = await this.agentResources.listResources()

            this.log('debug', 'List resources request completed', {
              responseTime: Date.now() - startTime,
              resourceCount: resources.length,
            })

            return { resources }
          } catch (error) {
            this.log('error', 'List resources request failed', {
              responseTime: Date.now() - startTime,
              error: error instanceof Error ? error.message : String(error),
            })
            throw error
          }
        }
      )

      this.server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request): Promise<ReadResourceResult> => {
          const startTime = Date.now()
          const { params } = request
          this.log('debug', 'Received read_resource request', { uri: params.uri })

          try {
            if (!this.agentResources.isValidResourceUri(params.uri)) {
              throw new ValidationError(
                `Invalid resource URI: ${params.uri}`,
                'INVALID_RESOURCE_URI'
              )
            }

            const result = await this.agentResources.readResource(params.uri)

            this.log('debug', 'Read resource request completed', {
              uri: params.uri,
              responseTime: Date.now() - startTime,
              contentLength: result.contents[0]?.text?.length || 0,
            })

            return result as unknown as ReadResourceResult
          } catch (error) {
            this.log('error', 'Read resource request failed', {
              uri: params.uri,
              responseTime: Date.now() - startTime,
              error: error instanceof Error ? error.message : String(error),
            })
            throw error
          }
        }
      )

      this.log('debug', 'MCP handlers configured successfully')
    } catch (error) {
      this.log('error', 'Failed to setup MCP handlers', { error: String(error) })
      throw new AppError('Failed to setup MCP handlers', 'HANDLERS_SETUP_FAILED')
    }
  }

  getServerInfo(): ServerInfo {
    return {
      name: this.config.serverName,
      version: this.config.serverVersion,
    }
  }

  hasTransport(): boolean {
    return this.transport !== null
  }

  isReady(): boolean {
    return this.hasTransport() && this.server !== null
  }

  async start(): Promise<void> {
    try {
      if (!this.isReady()) {
        throw new AppError('Server is not ready to start', 'SERVER_NOT_READY')
      }

      if (!this.transport) {
        throw new AppError('Transport not configured', 'TRANSPORT_NOT_CONFIGURED')
      }

      this.log('info', 'Starting MCP server...')

      await this.server.connect(this.transport)

      this.log('info', 'MCP server started successfully', {
        serverName: this.config.serverName,
        serverVersion: this.config.serverVersion,
      })
    } catch (error) {
      this.log('error', 'Failed to start MCP server', { error: String(error) })
      throw error instanceof AppError
        ? error
        : new AppError('Failed to start MCP server', 'SERVER_START_FAILED')
    }
  }

  async listTools(): Promise<
    Array<{ name: string; description: string; inputSchema: RunAgentTool['inputSchema'] }>
  > {
    return [
      {
        name: this.runAgentTool.name,
        description: this.runAgentTool.description,
        inputSchema: this.runAgentTool.inputSchema,
      },
    ]
  }

  async listResources(): Promise<Array<{ uri: string; name: string; description: string }>> {
    const resources = await this.agentResources.listResources()
    return resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
    }))
  }

  async callTool(
    toolName: string,
    params: unknown
  ): Promise<Awaited<ReturnType<RunAgentTool['execute']>>> {
    if (toolName === 'run_agent') {
      return await this.runAgentTool.execute(params)
    }
    throw new ValidationError(`Unknown tool: ${toolName}`, 'UNKNOWN_TOOL')
  }

  async readResource(uri: string): Promise<Awaited<ReturnType<AgentResources['readResource']>>> {
    if (!this.agentResources.isValidResourceUri(uri)) {
      throw new ValidationError(`Invalid resource URI: ${uri}`, 'INVALID_RESOURCE_URI')
    }
    return await this.agentResources.readResource(uri)
  }

  getServerStats(): {
    serverInfo: { name: string; version: string }
    executionStats: Map<string, { count: number; totalTime: number; lastUsed: Date }>
  } {
    return {
      serverInfo: this.getServerInfo(),
      executionStats: this.runAgentTool.getExecutionStats(),
    }
  }

  resetStats(): void {
    this.log('info', 'Server statistics reset')
  }

  async close(): Promise<void> {
    try {
      this.log('info', 'Shutting down MCP server...')

      const stats = this.getServerStats()
      this.log('info', 'Final server statistics', {
        executionCount: Array.from(stats.executionStats.values()).reduce(
          (sum, stat) => sum + stat.count,
          0
        ),
      })

      if (this.server) {
        await this.server.close()
      }

      this.log('info', 'MCP server shutdown completed')
    } catch (error) {
      this.log('error', 'Error during server shutdown', { error: String(error) })
      throw new AppError('Failed to shutdown MCP server gracefully', 'SERVER_SHUTDOWN_FAILED')
    }
  }
}
