#!/usr/bin/env node

import { ServerConfig } from './config/ServerConfig.js'
import { McpServer } from './server/McpServer.js'

async function main(): Promise<void> {
  try {
    const config = new ServerConfig()
    const server = new McpServer(config)
    await server.start()
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
