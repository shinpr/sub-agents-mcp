#!/usr/bin/env node

/**
 * MCP Server Application Entry Point
 *
 * Initializes and starts the MCP server with configuration loaded from
 * environment variables. This server provides AI agent execution capabilities
 * through the Model Context Protocol.
 */

import { ServerConfig } from './config/ServerConfig.js'
import { McpServer } from './server/McpServer.js'

/**
 * Main function to start the MCP server
 * @throws {Error} When server initialization or startup fails
 */
async function main(): Promise<void> {
  try {
    // Load configuration from environment
    const config = new ServerConfig()

    // Create and start MCP server
    const server = new McpServer(config)

    // Start the server
    await server.start()

    // Setup graceful shutdown handling
    process.on('SIGINT', async () => {
      await server.close()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await server.close()
      process.exit(0)
    })
  } catch (error) {
    console.error('Failed to start MCP server:', error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Unhandled error in main:', error)
  process.exit(1)
})

export { McpServer } from './server/McpServer.js'
