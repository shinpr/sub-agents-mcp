import fs from 'node:fs'
import path from 'node:path'
import type { ServerConfigInterface } from 'src/types/ServerConfig'

/**
 * Server configuration management class.
 *
 * Handles loading configuration from environment variables with fallback defaults,
 * validates configuration values, and provides type-safe access to server settings.
 *
 * Environment variables:
 * - SERVER_NAME: Name identifier for the MCP server (default: 'sub-agents-mcp-server')
 * - SERVER_VERSION: Version of the MCP server (default: '1.0.0')
 * - AGENTS_DIR: Directory containing agent definition files (default: './agents')
 * - CLI_COMMAND: Command for executing agents (default: 'claude-code')
 * - MAX_OUTPUT_SIZE: Maximum output size in bytes (default: 1048576)
 * - ENABLE_CACHE: Enable agent definition caching (default: 'true')
 * - LOG_LEVEL: Log level for server operations (default: 'info')
 */
export class ServerConfig implements ServerConfigInterface {
  /** Server name identifier used for MCP registration */
  public readonly serverName: string

  /** Server version used for identification */
  public readonly serverVersion: string

  /** Directory path containing agent definition markdown files */
  public readonly agentsDir: string

  /** CLI command used for agent execution */
  public readonly cliCommand: string

  /** Maximum output size in bytes for agent execution */
  public readonly maxOutputSize: number

  /** Whether to enable agent definition caching */
  public readonly enableCache: boolean

  /** Log level for server operations */
  public readonly logLevel: 'debug' | 'info' | 'warn' | 'error'

  /**
   * Creates a new ServerConfig instance by loading values from environment variables
   * or using default values. Validates the configuration upon creation.
   *
   * @throws {Error} When configuration validation fails
   */
  constructor() {
    // Load configuration from environment variables with defaults
    const serverNameEnv = process.env['SERVER_NAME']
    const serverVersionEnv = process.env['SERVER_VERSION']
    const agentsDirEnv = process.env['AGENTS_DIR']
    const cliCommandEnv = process.env['CLI_COMMAND']
    const maxOutputSizeEnv = process.env['MAX_OUTPUT_SIZE']
    const enableCacheEnv = process.env['ENABLE_CACHE']
    const logLevelEnv = process.env['LOG_LEVEL']

    this.serverName = serverNameEnv || 'sub-agents-mcp-server'
    this.serverVersion = serverVersionEnv || '1.0.0'
    this.agentsDir = agentsDirEnv || './agents'
    this.cliCommand = cliCommandEnv || 'claude-code'
    this.maxOutputSize = maxOutputSizeEnv ? Number.parseInt(maxOutputSizeEnv, 10) : 1048576 // 1MB default
    this.enableCache = enableCacheEnv !== 'false' // default to true
    this.logLevel = this.validateLogLevel(logLevelEnv) || 'info'

    // Validate configuration
    this.validate(serverNameEnv)
  }

  /**
   * Validates log level value from environment variable.
   *
   * @param logLevelEnv - Raw LOG_LEVEL environment variable value
   * @returns Valid log level or undefined if invalid
   */
  private validateLogLevel(
    logLevelEnv: string | undefined
  ): 'debug' | 'info' | 'warn' | 'error' | undefined {
    if (!logLevelEnv) return undefined

    const validLevels: Array<'debug' | 'info' | 'warn' | 'error'> = [
      'debug',
      'info',
      'warn',
      'error',
    ]
    if (validLevels.includes(logLevelEnv as 'debug' | 'info' | 'warn' | 'error')) {
      return logLevelEnv as 'debug' | 'info' | 'warn' | 'error'
    }

    return undefined
  }

  /**
   * Validates configuration values for correctness and availability.
   *
   * @param serverNameEnv - Raw SERVER_NAME environment variable value
   * @throws {Error} When validation fails with descriptive error message
   */
  private validate(serverNameEnv: string | undefined): void {
    // First validate server name - check the original env value, not the defaulted value
    if (serverNameEnv !== undefined && (!serverNameEnv || serverNameEnv.trim() === '')) {
      throw new Error('Configuration validation failed: SERVER_NAME cannot be empty')
    }

    // Check if agents directory exists and is readable
    if (this.agentsDir !== './agents') {
      try {
        const resolvedPath = path.resolve(this.agentsDir)
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(
            'Configuration validation failed: AGENTS_DIR does not exist or is not readable'
          )
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Configuration validation failed')) {
          throw error
        }
        throw new Error(
          'Configuration validation failed: AGENTS_DIR does not exist or is not readable'
        )
      }
    }
  }

  /**
   * Creates a new ServerConfig instance from environment variables.
   *
   * @returns Promise resolving to a new ServerConfig instance
   * @throws {Error} When configuration validation fails
   */
  public static async fromEnvironment(): Promise<ServerConfig> {
    return new ServerConfig()
  }

  /**
   * Returns configuration as a readonly object.
   *
   * Useful for safely passing configuration to other components
   * without allowing modification of the original values.
   *
   * @returns Frozen configuration object that cannot be modified
   */
  public toObject(): Readonly<ServerConfigInterface> {
    return Object.freeze({
      serverName: this.serverName,
      serverVersion: this.serverVersion,
      agentsDir: this.agentsDir,
      cliCommand: this.cliCommand,
      maxOutputSize: this.maxOutputSize,
      enableCache: this.enableCache,
      logLevel: this.logLevel,
    })
  }
}
