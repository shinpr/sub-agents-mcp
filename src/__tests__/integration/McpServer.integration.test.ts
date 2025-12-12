/**
 * Integration tests for McpServer with tools and resources
 *
 * Tests the complete MCP server functionality including run_agent tool
 * registration, agent resources publication, and MCP client interaction.
 */

import { AgentManager } from 'src/agents/AgentManager'
import { AgentExecutor } from 'src/execution/AgentExecutor'
import { McpServer } from 'src/server/McpServer'
import type { ServerConfigInterface } from 'src/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('McpServer Integration', () => {
  let server: McpServer
  let mockConfig: ServerConfigInterface

  beforeEach(() => {
    mockConfig = {
      serverName: 'test-mcp-server',
      serverVersion: '1.0.0',
      agentsDir: './test-agents',
      logLevel: 'info',
      agentType: 'cursor',
      executionTimeoutMs: 300000,
    }
  })

  afterEach(async () => {
    if (server) {
      await server.close()
    }
  })

  describe('tool registration', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should register run_agent tool during initialization', async () => {
      // This test will fail initially as run_agent tool integration is not implemented
      const tools = await server.listTools()

      expect(tools).toBeDefined()
      expect(Array.isArray(tools)).toBe(true)

      const runAgentTool = tools.find((tool) => tool.name === 'run_agent')
      expect(runAgentTool).toBeDefined()
      expect(runAgentTool?.description).toContain(
        'Delegate complex, multi-step, or specialized tasks'
      )
    })

    it('should have correct run_agent tool schema', async () => {
      const tools = await server.listTools()
      const runAgentTool = tools.find((tool) => tool.name === 'run_agent')

      expect(runAgentTool?.inputSchema).toBeDefined()
      expect(runAgentTool?.inputSchema.type).toBe('object')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('agent')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('prompt')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('cwd')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('extra_args')
      expect(runAgentTool?.inputSchema.required).toEqual(['agent', 'prompt', 'cwd'])
    })
  })

  describe('agent resources', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should publish agent list resource', async () => {
      // This test will fail initially as agent resources are not implemented
      const resources = await server.listResources()

      expect(resources).toBeDefined()
      expect(Array.isArray(resources)).toBe(true)

      const agentListResource = resources.find((resource) => resource.uri === 'agents://list')
      expect(agentListResource).toBeDefined()
      expect(agentListResource?.name).toBe('Agent List')
      expect(agentListResource?.description).toContain('List of available Claude Code sub-agents')
    })

    it('should provide individual agent resources with valid URI format', async () => {
      const resources = await server.listResources()

      // Check if individual agent resources are available
      const agentResources = resources.filter(
        (resource) => resource.uri.startsWith('agents://') && resource.uri !== 'agents://list'
      )

      // If there are agent resources, verify their structure
      for (const agentResource of agentResources) {
        expect(agentResource.name).toBeTruthy()
        expect(agentResource.description).toBeTruthy()
        expect(agentResource.uri).toMatch(/^agents:\/\/[\w-]+$/)
      }
    })
  })

  describe('tool execution', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should execute run_agent tool with valid parameters', async () => {
      // This test will fail initially as tool execution is not fully implemented
      const params = {
        agent: 'test-agent',
        prompt: 'Hello, world!',
        cwd: process.cwd(),
      }

      const result = await server.callTool('run_agent', params)

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
      expect(Array.isArray(result.content)).toBe(true)
      expect(result.content.length).toBeGreaterThan(0)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent).toBeDefined()
      expect(textContent?.text).toBeDefined()
    })

    it('should validate run_agent tool parameters', async () => {
      const invalidParams = {
        // Missing required 'agent' parameter
        prompt: 'Test prompt',
      }

      const result = (await server.callTool('run_agent', invalidParams)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/agent.*required/i)
    })

    it('should handle non-existent agent gracefully', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }

      const result = await server.callTool('run_agent', params)

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toMatch(/not found|Failed to load agents/i)
    })
  })

  describe('resource access', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should provide agent list resource content', async () => {
      // This test will fail initially as resource access is not implemented
      const resource = await server.readResource('agents://list')

      expect(resource).toBeDefined()
      expect(resource.contents).toBeDefined()
      expect(Array.isArray(resource.contents)).toBe(true)

      if (resource.contents.length > 0) {
        const content = resource.contents[0]
        expect(content.type).toBe('text')
        expect(content.text).toBeDefined()
      }
    })

    it('should provide individual agent resource content', async () => {
      // First get the list of available agents
      const listResource = await server.readResource('agents://list')

      if (listResource.contents.length > 0) {
        const agentName = 'test-agent' // Use a test agent name
        const agentResource = await server.readResource(`agents://${agentName}`)

        expect(agentResource).toBeDefined()
        expect(agentResource.contents).toBeDefined()
        expect(Array.isArray(agentResource.contents)).toBe(true)

        if (agentResource.contents.length > 0) {
          const content = agentResource.contents[0]
          expect(content.type).toBe('text')
          expect(content.text).toBeDefined()
        }
      }
    })
  })

  describe('MCP client interaction', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should handle complete agent execution workflow', async () => {
      // This test simulates a complete MCP client interaction
      // 1. List available tools
      const tools = await server.listTools()
      expect(tools.find((t) => t.name === 'run_agent')).toBeDefined()

      // 2. List available resources
      const resources = await server.listResources()
      expect(resources.find((r) => r.uri === 'agents://list')).toBeDefined()

      // 3. Read agent list resource
      const agentList = await server.readResource('agents://list')
      expect(agentList).toBeDefined()

      // 4. Execute run_agent tool
      const executionResult = await server.callTool('run_agent', {
        agent: 'test-agent',
        prompt: 'Test execution',
        cwd: process.cwd(),
      })

      expect(executionResult).toBeDefined()
      expect(executionResult.content).toBeDefined()
    })

    it('should maintain consistent state across operations', async () => {
      // Perform multiple operations to ensure server state consistency
      const tools1 = await server.listTools()
      const resources1 = await server.listResources()

      // Execute a tool
      await server.callTool('run_agent', {
        agent: 'test-agent',
        prompt: 'State test',
        cwd: process.cwd(),
      })

      // Check that tool and resource lists remain consistent
      const tools2 = await server.listTools()
      const resources2 = await server.listResources()

      expect(tools2).toEqual(tools1)
      expect(resources2).toEqual(resources1)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should handle unknown tool calls gracefully', async () => {
      await expect(server.callTool('unknown_tool', {})).rejects.toThrow(/unknown.*tool/i)
    })

    it('should handle invalid resource URIs gracefully', async () => {
      await expect(server.readResource('invalid://resource')).rejects.toThrow(
        /unknown.*resource|invalid.*uri/i
      )
    })

    it('should provide meaningful error messages', async () => {
      const result = (await server.callTool('run_agent', {
        /* missing required params */
      })) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/agent.*required|prompt.*required/i)
    })
  })
})
