/**
 * Tests for McpServer class
 *
 * Tests basic MCP server functionality including initialization,
 * configuration integration, and transport setup.
 */

import { McpServer } from 'src/server/McpServer'
import type { ServerConfigInterface } from 'src/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('McpServer', () => {
  let server: McpServer
  let mockConfig: ServerConfigInterface

  beforeEach(() => {
    mockConfig = {
      serverName: 'test-mcp-server',
      serverVersion: '1.0.0',
      agentsDir: './test-agents',
      logLevel: 'info',
    }
  })

  afterEach(() => {
    if (server) {
      server.close()
    }
  })

  describe('instantiation', () => {
    it('should create McpServer instance with valid configuration', () => {
      expect(() => {
        server = new McpServer(mockConfig)
      }).not.toThrow()
      expect(server).toBeDefined()
    })

    it('should throw error with invalid configuration', () => {
      const invalidConfig = { ...mockConfig, serverName: '' }
      expect(() => {
        new McpServer(invalidConfig)
      }).toThrow('Server name cannot be empty')
    })
  })

  describe('server info', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should return server name from configuration', () => {
      const info = server.getServerInfo()
      expect(info.name).toBe(mockConfig.serverName)
    })

    it('should return server version from configuration', () => {
      const info = server.getServerInfo()
      expect(info.version).toBe(mockConfig.serverVersion)
    })
  })

  describe('transport setup', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should configure StdioServerTransport', () => {
      expect(server.hasTransport()).toBe(true)
    })

    it('should be ready to start server', () => {
      expect(server.isReady()).toBe(true)
    })
  })

  describe('server lifecycle', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should handle graceful shutdown', async () => {
      await expect(server.close()).resolves.not.toThrow()
    })
  })
})
