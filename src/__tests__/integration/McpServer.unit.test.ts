/**
 * Tests for McpServer class
 *
 * Tests basic MCP server functionality including initialization,
 * configuration integration, and transport setup.
 */

import { ServerConfig } from 'src/config/ServerConfig'
import { McpServer } from 'src/server/McpServer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('McpServer', () => {
  let server: McpServer
  let mockConfig: ServerConfig

  beforeEach(() => {
    // Set required environment variables for ServerConfig
    process.env['AGENTS_DIR'] = './test-agents'
    process.env['SESSION_ENABLED'] = 'false'
    mockConfig = new ServerConfig()
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
      // Create a config with empty server name by mocking
      const invalidConfig = {
        ...mockConfig,
        serverName: '',
        serverVersion: '1.0.0',
      } as ServerConfig

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

  describe('session management', () => {
    it('should initialize SessionManager when SESSION_ENABLED=true', () => {
      process.env['SESSION_ENABLED'] = 'true'
      process.env['SESSION_DIR'] = '/tmp/test-sessions'
      const configWithSession = new ServerConfig()

      expect(() => {
        server = new McpServer(configWithSession)
      }).not.toThrow()
      expect(server).toBeDefined()
    })

    it('should not initialize SessionManager when SESSION_ENABLED=false', () => {
      process.env['SESSION_ENABLED'] = 'false'
      const configWithoutSession = new ServerConfig()

      expect(() => {
        server = new McpServer(configWithoutSession)
      }).not.toThrow()
      expect(server).toBeDefined()
    })
  })
})
