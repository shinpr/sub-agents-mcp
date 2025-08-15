/**
 * Unit tests for RunAgentTool class
 *
 * Tests the run_agent tool implementation including parameter validation,
 * agent execution integration, and MCP response formatting.
 */

import { AgentManager } from 'src/agents/AgentManager'
import { AgentExecutor, createExecutionConfig } from 'src/execution/AgentExecutor'
import { RunAgentTool } from 'src/tools/RunAgentTool'
import type { ServerConfigInterface } from 'src/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('RunAgentTool', () => {
  let runAgentTool: RunAgentTool
  let mockAgentExecutor: AgentExecutor
  let mockAgentManager: AgentManager
  let mockConfig: ServerConfigInterface

  beforeEach(() => {
    mockConfig = {
      serverName: 'test-server',
      serverVersion: '1.0.0',
      agentsDir: './test-agents',
      cliCommand: 'echo',
      maxOutputSize: 1024 * 1024,
      enableCache: true,
      logLevel: 'info',
    }

    const executionConfig = createExecutionConfig('echo')
    mockAgentExecutor = new AgentExecutor(executionConfig)
    mockAgentManager = new AgentManager(mockConfig)

    // This will fail initially as RunAgentTool is not implemented
    runAgentTool = new RunAgentTool(mockAgentExecutor, mockAgentManager)
  })

  describe('instantiation', () => {
    it('should create RunAgentTool instance with dependencies', () => {
      expect(() => {
        new RunAgentTool(mockAgentExecutor, mockAgentManager)
      }).not.toThrow()
    })

    it('should create RunAgentTool with default dependencies', () => {
      expect(() => {
        new RunAgentTool()
      }).not.toThrow()
    })
  })

  describe('tool definition', () => {
    it('should provide correct tool name', () => {
      expect(runAgentTool.name).toBe('run_agent')
    })

    it('should provide descriptive tool description', () => {
      expect(runAgentTool.description).toContain('Execute a Claude Code sub-agent')
      expect(runAgentTool.description).toContain('specified parameters')
    })

    it('should provide correct input schema', () => {
      const schema = runAgentTool.inputSchema

      expect(schema.type).toBe('object')
      expect(schema.properties).toHaveProperty('agent')
      expect(schema.properties).toHaveProperty('prompt')
      expect(schema.properties).toHaveProperty('cwd')
      expect(schema.properties).toHaveProperty('extra_args')

      expect(schema.required).toEqual(['agent', 'prompt'])

      // Verify property types
      expect(schema.properties.agent.type).toBe('string')
      expect(schema.properties.prompt.type).toBe('string')
      expect(schema.properties.cwd.type).toBe('string')
      expect(schema.properties.extra_args.type).toBe('array')
      expect(schema.properties.extra_args.items.type).toBe('string')
    })
  })

  describe('parameter validation', () => {
    it('should validate required agent parameter', async () => {
      const params = {
        prompt: 'Test prompt',
        // Missing agent parameter
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/agent.*required|missing.*agent/i)
    })

    it('should validate required prompt parameter', async () => {
      const params = {
        agent: 'test-agent',
        // Missing prompt parameter
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/prompt.*required|missing.*prompt/i)
    })

    it('should validate empty agent parameter', async () => {
      const params = {
        agent: '',
        prompt: 'Test prompt',
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/agent.*required|invalid.*agent/i)
    })

    it('should validate empty prompt parameter', async () => {
      const params = {
        agent: 'test-agent',
        prompt: '',
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/prompt.*required|invalid.*prompt/i)
    })

    it('should accept valid optional parameters', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: '/test/directory',
        extra_args: ['--verbose', '--debug'],
      }

      // Mock the execution to avoid actual agent execution
      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        executionMethod: 'exec',
        estimatedOutputSize: 1024,
      })

      const result = await runAgentTool.execute(params)
      expect(result).toBeDefined()
    })
  })

  describe('agent execution', () => {
    beforeEach(() => {
      // Mock agent existence check
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'Test agent content',
        filePath: '/test/agents/test-agent.md',
        lastModified: new Date(),
      })
    })

    it('should execute agent with valid parameters', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
      }

      const mockResult = {
        stdout: 'Agent execution result',
        stderr: '',
        exitCode: 0,
        executionTime: 150,
        executionMethod: 'exec' as const,
        estimatedOutputSize: 2048,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
      expect(Array.isArray(result.content)).toBe(true)
      expect(result.content.length).toBeGreaterThan(0)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent).toBeDefined()
      expect(textContent?.text).toContain('Agent execution result')
    })

    it('should handle agent execution with stderr output', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
      }

      const mockResult = {
        stdout: 'Warning output',
        stderr: 'Non-critical warning message',
        exitCode: 0,
        executionTime: 200,
        executionMethod: 'exec' as const,
        estimatedOutputSize: 1024,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('Warning output')
      expect(textContent?.text).toContain('Non-critical warning message')
    })

    it('should handle agent execution failure', async () => {
      const params = {
        agent: 'failing-agent',
        prompt: 'Test prompt',
      }

      const mockResult = {
        stdout: '',
        stderr: 'Agent execution failed',
        exitCode: 1,
        executionTime: 50,
        executionMethod: 'exec' as const,
        estimatedOutputSize: 512,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('failed')
      expect(textContent?.text).toContain('exit code: 1')
    })

    it('should include execution metadata in response', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
      }

      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 300,
        executionMethod: 'spawn' as const,
        estimatedOutputSize: 2048000,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('**Execution Time:** 300ms')
      expect(textContent?.text).toContain('**Method:** spawn')
    })
  })

  describe('nonexistent agent handling', () => {
    it('should handle nonexistent agent gracefully', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
      }

      // Mock agent not found
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue(undefined)

      const result = await runAgentTool.execute(params)

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toMatch(/agent.*not found|nonexistent.*agent/i)
    })

    it('should include available agents in error message', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
      }

      // Mock agent not found
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue(undefined)
      vi.spyOn(mockAgentManager, 'listAgents').mockResolvedValue([
        {
          name: 'agent1',
          description: 'First agent',
          content: 'Content 1',
          filePath: '/test/agent1.md',
          lastModified: new Date(),
        },
        {
          name: 'agent2',
          description: 'Second agent',
          content: 'Content 2',
          filePath: '/test/agent2.md',
          lastModified: new Date(),
        },
      ])

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('agent1')
      expect(textContent?.text).toContain('agent2')
      expect(textContent?.text).toContain('Available agents')
    })
  })

  describe('response formatting', () => {
    beforeEach(() => {
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'Test content',
        filePath: '/test/test-agent.md',
        lastModified: new Date(),
      })
    })

    it('should format successful execution response correctly', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
      }

      const mockResult = {
        stdout: 'Agent output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        executionMethod: 'exec' as const,
        estimatedOutputSize: 1024,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      expect(result).toMatchObject({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Agent output'),
          }),
        ]),
      })
    })

    it('should include structured execution details in response', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test with details',
      }

      const mockResult = {
        stdout: 'Detailed output',
        stderr: 'Warning message',
        exitCode: 0,
        executionTime: 250,
        executionMethod: 'spawn' as const,
        estimatedOutputSize: 5000000,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('**Agent:** test-agent')
      expect(textContent?.text).toContain('**Exit Code:** 0')
      expect(textContent?.text).toContain('**Execution Time:** 250ms')
      expect(textContent?.text).toContain('**Method:** spawn')
    })
  })

  describe('error handling', () => {
    it('should handle agent executor errors gracefully', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
      }

      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'Test content',
        filePath: '/test/test-agent.md',
        lastModified: new Date(),
      })

      // Mock executor throwing an error
      vi.spyOn(mockAgentExecutor, 'executeAgent').mockRejectedValue(
        new Error('Execution failed unexpectedly')
      )

      const result = await runAgentTool.execute(params)

      expect(result).toBeDefined()
      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toMatch(/error|failed/i)
    })

    it('should handle agent manager errors gracefully', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
      }

      // Mock agent manager throwing an error
      vi.spyOn(mockAgentManager, 'getAgent').mockRejectedValue(new Error('Failed to load agent'))

      const result = await runAgentTool.execute(params)

      expect(result).toBeDefined()
      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toMatch(/error.*loading|failed.*load/i)
    })
  })
})
