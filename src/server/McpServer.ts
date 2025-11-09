/**
 * MCP Server implementation using @modelcontextprotocol/sdk
 *
 * Provides the foundational MCP server functionality with StdioServerTransport
 * for stdin/stdout communication. This class serves as the entry point for
 * the MCP server and handles basic server lifecycle operations.
 *
 * @example
 * ```typescript
 * const config = await ServerConfig.fromEnvironment()
 * const server = new McpServer(config)
 * await server.start()
 * ```
 */

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
import { AgentManager } from 'src/agents/AgentManager'
import type { ServerConfig } from 'src/config/ServerConfig'
import { AgentExecutor, createExecutionConfig } from 'src/execution/AgentExecutor'
import { AgentResources } from 'src/resources/AgentResources'
import { RunAgentTool } from 'src/tools/RunAgentTool'
import { AppError, ValidationError } from 'src/utils/ErrorHandler'
import { Logger } from 'src/utils/Logger'

/**
 * Server information interface for MCP server identification
 */
interface ServerInfo {
  name: string
  version: string
}

/**
 * Logger function type for structured logging
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * MCP Server class providing foundational server functionality
 */
export class McpServer {
  private server: Server
  private transport: StdioServerTransport | null = null
  private config: ServerConfig
  private agentManager: AgentManager
  private agentExecutor: AgentExecutor
  private runAgentTool: RunAgentTool
  private agentResources: AgentResources

  /**
   * Create a new MCP server instance
   * @param config Server configuration object
   * @throws {Error} When server name is empty
   */
  constructor(config: ServerConfig) {
    this.validateConfig(config)
    this.config = config

    this.log('info', 'Initializing MCP server', {
      name: config.serverName,
      version: config.serverVersion,
    })

    // Initialize agent management components
    this.agentManager = new AgentManager(config)

    // Create ExecutionConfig with the agent type from server config
    const executionConfig = createExecutionConfig(config.agentType, {
      executionTimeout: config.executionTimeoutMs, // Use timeout from config (env var or 90s default)
    })

    // Create logger with log level from config
    const executorLogger = new Logger(config.logLevel)

    this.agentExecutor = new AgentExecutor(executionConfig, executorLogger)
    this.runAgentTool = new RunAgentTool(this.agentExecutor, this.agentManager)
    this.agentResources = new AgentResources(this.agentManager)

    // Initialize MCP server with capabilities
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

    // Setup StdioServerTransport for stdin/stdout communication
    this.setupTransport()

    // Setup MCP handlers
    this.setupHandlers()

    this.log('info', 'MCP server initialized successfully')
  }

  /**
   * Validate server configuration
   * @param config Configuration to validate
   * @throws {Error} When configuration is invalid
   */
  private validateConfig(config: ServerConfig): void {
    if (!config.serverName || config.serverName.trim() === '') {
      throw new Error('Server name cannot be empty')
    }
    if (!config.serverVersion || config.serverVersion.trim() === '') {
      throw new Error('Server version cannot be empty')
    }
  }

  /**
   * Log message with structured format
   * @param level Log level
   * @param message Log message
   * @param metadata Additional metadata
   */
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

  /**
   * Setup StdioServerTransport for MCP communication
   */
  private setupTransport(): void {
    try {
      this.transport = new StdioServerTransport()
      this.log('debug', 'StdioServerTransport configured successfully')
    } catch (error) {
      this.log('error', 'Failed to setup transport', { error: String(error) })
      throw new AppError('Failed to setup MCP transport', 'TRANSPORT_SETUP_FAILED')
    }
  }

  /**
   * Setup MCP protocol handlers with performance monitoring
   */
  private setupHandlers(): void {
    try {
      // List tools handler
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

      // Call tool handler
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

      // List resources handler
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

      // Read resource handler
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

  /**
   * Get server information
   * @returns Server name and version
   */
  getServerInfo(): ServerInfo {
    return {
      name: this.config.serverName,
      version: this.config.serverVersion,
    }
  }

  /**
   * Check if transport is configured
   * @returns True if transport is available
   */
  hasTransport(): boolean {
    return this.transport !== null
  }

  /**
   * Check if server is ready to start
   * @returns True if server is ready
   */
  isReady(): boolean {
    return this.hasTransport() && this.server !== null
  }

  /**
   * Start the MCP server
   * @throws {Error} When server is not ready or transport setup fails
   */
  async start(): Promise<void> {
    try {
      if (!this.isReady()) {
        throw new AppError('Server is not ready to start', 'SERVER_NOT_READY')
      }

      if (!this.transport) {
        throw new AppError('Transport not configured', 'TRANSPORT_NOT_CONFIGURED')
      }

      this.log('info', 'Starting MCP server...')

      // Connect server to transport
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

  /**
   * List available tools (for testing)
   * @returns Promise resolving to array of tool definitions
   */
  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    return [
      {
        name: this.runAgentTool.name,
        description: this.runAgentTool.description,
        inputSchema: this.runAgentTool.inputSchema,
      },
    ]
  }

  /**
   * List available resources (for testing)
   * @returns Promise resolving to array of resource definitions
   */
  async listResources(): Promise<Array<{ uri: string; name: string; description: string }>> {
    const resources = await this.agentResources.listResources()
    return resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
    }))
  }

  /**
   * Call a tool (for testing)
   * @param toolName - Name of the tool to call
   * @param params - Tool parameters
   * @returns Promise resolving to tool response
   */
  async callTool(toolName: string, params: unknown): Promise<unknown> {
    if (toolName === 'run_agent') {
      return await this.runAgentTool.execute(params)
    }
    throw new ValidationError(`Unknown tool: ${toolName}`, 'UNKNOWN_TOOL')
  }

  /**
   * Read a resource (for testing)
   * @param uri - Resource URI to read
   * @returns Promise resolving to resource content
   */
  async readResource(uri: string): Promise<unknown> {
    if (!this.agentResources.isValidResourceUri(uri)) {
      throw new ValidationError(`Invalid resource URI: ${uri}`, 'INVALID_RESOURCE_URI')
    }
    return await this.agentResources.readResource(uri)
  }

  /**
   * Get server performance statistics
   *
   * @returns Performance and usage statistics
   */
  getServerStats(): {
    serverInfo: { name: string; version: string }
    executionStats: Map<string, { count: number; totalTime: number; lastUsed: Date }>
  } {
    return {
      serverInfo: this.getServerInfo(),
      executionStats: this.runAgentTool.getExecutionStats(),
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.log('info', 'Server statistics reset')
  }

  /**
   * Close the server and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.log('info', 'Shutting down MCP server...')

      // Log final statistics before shutdown
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
