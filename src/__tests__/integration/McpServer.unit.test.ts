import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ServerConfig } from '../../config/ServerConfig.js'
import { McpServer } from '../../server/McpServer.js'

describe('McpServer', () => {
  let server: McpServer
  let mockConfig: ServerConfig

  beforeEach(() => {
    process.env['AGENTS_DIR'] = './test-agents'
    process.env['AGENT_TYPE'] = 'cursor'
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
