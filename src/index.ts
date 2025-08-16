#!/usr/bin/env node

/**
 * MCP Server Application Entry Point
 *
 * Initializes and starts the MCP server with configuration loaded from
 * environment variables. This server provides AI agent execution capabilities
 * through the Model Context Protocol.
 */

import { ServerConfig } from 'src/config/ServerConfig'
import { McpServer } from 'src/server/McpServer'

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

// Start the server if this module is the main entry point
// Note: Using process.argv check instead of import.meta for broader compatibility
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error in main:', error)
    process.exit(1)
  })
}

export { McpServer } from 'src/server/McpServer'
