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
      agentType: 'cursor',
      logLevel: 'info',
      executionTimeoutMs: 300000,
    }

    const executionConfig = createExecutionConfig('cursor')
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
      expect(runAgentTool.description).toContain(
        'Delegate complex, multi-step, or specialized tasks'
      )
      expect(runAgentTool.description).toContain('autonomous agent')
    })

    it('should provide correct input schema', () => {
      const schema = runAgentTool.inputSchema

      expect(schema.type).toBe('object')
      expect(schema.properties).toHaveProperty('agent')
      expect(schema.properties).toHaveProperty('prompt')
      expect(schema.properties).toHaveProperty('cwd')
      expect(schema.properties).toHaveProperty('extra_args')
      expect(schema.properties).toHaveProperty('session_id')

      expect(schema.required).toEqual(['agent', 'prompt'])

      // Verify property types
      expect(schema.properties.agent.type).toBe('string')
      expect(schema.properties.prompt.type).toBe('string')
      expect(schema.properties.cwd.type).toBe('string')
      expect(schema.properties.extra_args.type).toBe('array')
      expect(schema.properties.extra_args.items.type).toBe('string')
      expect(schema.properties.session_id.type).toBe('string')
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
        hasResult: false,
        resultJson: undefined,
        estimatedOutputSize: 1024,
      })

      const result = await runAgentTool.execute(params)
      expect(result).toBeDefined()
    })

    it('should accept valid session_id parameter', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt with session',
        session_id: 'test-session-123',
      }

      // Mock agent existence check
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'Test agent content',
        filePath: '/test/agents/test-agent.md',
        lastModified: new Date(),
      })

      // Mock the execution to avoid actual agent execution
      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: 'Test output with session',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
        estimatedOutputSize: 1024,
      })

      const result = await runAgentTool.execute(params)
      expect(result).toBeDefined()
      expect(result.isError).not.toBe(true)
    })

    it('should reject empty session_id parameter', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        session_id: '',
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/session.*id.*empty|invalid.*session/i)
    })

    it('should reject session_id with invalid characters', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        session_id: 'session/with/../invalid',
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/session.*id.*invalid.*characters/i)
    })

    it('should reject session_id that is too long', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        session_id: 'a'.repeat(101), // 101 characters, exceeds max of 100
      }

      const result = (await runAgentTool.execute(params)) as any
      expect(result.content).toBeDefined()
      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toMatch(/session.*id.*too long/i)
    })

    it('should work without session_id for backward compatibility', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt without session',
        // No session_id provided
      }

      // Mock agent existence check
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'Test agent content',
        filePath: '/test/agents/test-agent.md',
        lastModified: new Date(),
      })

      // Mock the execution to avoid actual agent execution
      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: 'Test output without session',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
        estimatedOutputSize: 1024,
      })

      const result = await runAgentTool.execute(params)
      expect(result).toBeDefined()
      expect(result.isError).not.toBe(true)
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
        hasResult: false,
        resultJson: undefined,
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
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('Warning output')
      // stderr is included in structured content, not in text content when stdout exists
      expect(result.structuredContent).toHaveProperty('stderr', 'Non-critical warning message')
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
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('failed')
      // exit code is in structured content, not text content
      expect(result.structuredContent).toHaveProperty('exitCode', 1)
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
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('Success')
      // Metadata is in structured content, not text content
      expect(result.structuredContent).toHaveProperty('executionTime', 300)
      expect(result.structuredContent).toHaveProperty('exitCode', 0)
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
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('Detailed output')
      // All metadata is in structured content, not text content
      expect(result.structuredContent).toHaveProperty('agent', 'test-agent')
      expect(result.structuredContent).toHaveProperty('exitCode', 0)
      expect(result.structuredContent).toHaveProperty('executionTime', 250)
      expect(result.structuredContent).toHaveProperty('stderr', 'Warning message')
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

  describe('exit code interpretation with hasResult', () => {
    beforeEach(() => {
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'Test content',
        filePath: '/test/test-agent.md',
        lastModified: new Date(),
      })
    })

    it('should treat exit code 143 with hasResult=true as success', async () => {
      const params = {
        agent: 'streaming-agent',
        prompt: 'Test streaming',
      }

      // Mock SIGTERM termination after successful JSON retrieval
      const mockResult = {
        stdout: '{"type":"result","data":"Streaming completed"}',
        stderr: '',
        exitCode: 143, // SIGTERM
        executionTime: 150,
        hasResult: true,
        resultJson: { type: 'result', data: 'Streaming completed' },
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)
      const textContent = result.content.find((c) => c.type === 'text')

      // Content should be the agent output
      expect(textContent?.text).toBe('{"type":"result","data":"Streaming completed"}')
      // Check status in structuredContent
      expect(result.structuredContent).toMatchObject({
        status: 'success',
        exitCode: 143,
        hasResult: true,
      })
    })

    it('should treat exit code 124 with hasResult=true as partial success', async () => {
      const params = {
        agent: 'timeout-agent',
        prompt: 'Test timeout with partial',
      }

      // Mock timeout but with partial result
      const mockResult = {
        stdout: '{"type":"partial","data":"Partial result"}',
        stderr: 'Execution timeout: 300000ms',
        exitCode: 124, // Timeout
        executionTime: 300000,
        hasResult: true,
        resultJson: { type: 'partial', data: 'Partial result' },
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)
      const textContent = result.content.find((c) => c.type === 'text')

      // Content should be the agent output
      expect(textContent?.text).toBe('{"type":"partial","data":"Partial result"}')
      // Check partial status in structuredContent
      expect(result.structuredContent).toMatchObject({
        status: 'partial',
        exitCode: 124,
        hasResult: true,
      })
    })

    it('should treat exit code 124 with hasResult=false as complete timeout', async () => {
      const params = {
        agent: 'timeout-agent',
        prompt: 'Test complete timeout',
      }

      // Mock complete timeout without any result
      const mockResult = {
        stdout: '',
        stderr: 'Execution timeout: 300000ms',
        exitCode: 124, // Timeout
        executionTime: 300000,
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)
      const textContent = result.content.find((c) => c.type === 'text')

      // Content should be the stderr message
      expect(textContent?.text).toBe('Execution timeout: 300000ms')
      // Check error status in structuredContent
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        exitCode: 124,
        hasResult: false,
      })
    })

    it('should treat exit code 0 as success regardless of hasResult', async () => {
      const params = {
        agent: 'normal-agent',
        prompt: 'Test normal completion',
      }

      // Mock normal completion
      const mockResult = {
        stdout: 'Normal output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false, // Even without JSON result
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)
      const textContent = result.content.find((c) => c.type === 'text')

      // Content should be the agent output
      expect(textContent?.text).toBe('Normal output')
      // Check success status in structuredContent
      expect(result.structuredContent).toMatchObject({
        status: 'success',
        exitCode: 0,
        hasResult: false,
      })
    })

    it('should include isError flag in response based on exit code and hasResult', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test isError flag',
      }

      // Test failure case
      const mockResult = {
        stdout: '',
        stderr: 'Error message',
        exitCode: 1,
        executionTime: 50,
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      // Should have isError flag set to true for failures
      expect(result).toHaveProperty('isError')
      expect(result.isError).toBe(true)
    })

    it('should include structuredContent with status and result', async () => {
      const params = {
        agent: 'json-agent',
        prompt: 'Return structured data',
      }

      const mockResult = {
        stdout: '{"type":"result","data":"test"}',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: true,
        resultJson: { type: 'result', data: 'test' },
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await runAgentTool.execute(params)

      // Verify structuredContent
      expect(result).toHaveProperty('structuredContent')
      expect(result.structuredContent).toMatchObject({
        agent: 'json-agent',
        exitCode: 0,
        executionTime: 100,
        hasResult: true,
        status: 'success',
        result: { type: 'result', data: 'test' },
      })
    })
  })
})
