import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerConfig } from '../../config/ServerConfig.js'
import { AgentExecutor } from '../../execution/AgentExecutor.js'
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

  afterEach(async () => {
    if (server) {
      await server.close()
    }
    vi.restoreAllMocks()
  })

  describe('instantiation', () => {
    it('should throw error with invalid configuration', () => {
      const invalidConfig: ServerConfig = {
        ...mockConfig,
        serverName: '',
        serverVersion: '1.0.0',
      }

      expect(() => {
        new McpServer(invalidConfig)
      }).toThrow('Server name cannot be empty')
    })
  })

  describe('server lifecycle', () => {
    it('should terminate running agent processes on close', async () => {
      const terminateAll = vi.spyOn(AgentExecutor.prototype, 'terminateAll')
      server = new McpServer(mockConfig)

      await server.close()

      expect(terminateAll).toHaveBeenCalledTimes(1)
    })
  })
})
