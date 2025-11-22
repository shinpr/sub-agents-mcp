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
      // stderr is agent implementation detail and should NOT be in structuredContent
      expect(result.structuredContent).not.toHaveProperty('stderr')
      expect(result.structuredContent).not.toHaveProperty('result')
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
      // Only MCP-managed metadata is in structured content, not agent implementation details
      expect(result.structuredContent).toHaveProperty('agent', 'test-agent')
      expect(result.structuredContent).toHaveProperty('exitCode', 0)
      expect(result.structuredContent).toHaveProperty('executionTime', 250)
      // Agent implementation details should NOT be in structuredContent
      expect(result.structuredContent).not.toHaveProperty('stderr')
      expect(result.structuredContent).not.toHaveProperty('result')
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

      // Verify structuredContent contains only MCP-managed metadata
      expect(result).toHaveProperty('structuredContent')
      expect(result.structuredContent).toMatchObject({
        agent: 'json-agent',
        exitCode: 0,
        executionTime: 100,
        hasResult: true,
        status: 'success',
      })
      // Agent implementation details (resultJson) should NOT be in structuredContent
      expect(result.structuredContent).not.toHaveProperty('result')
    })
  })

  describe('session ID auto-generation', () => {
    it('should auto-generate session_id when not provided and SessionManager is available', async () => {
      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(null),
        saveSession: vi.fn().mockResolvedValue(undefined),
      }

      const toolWithSession = new RunAgentTool(
        mockAgentExecutor,
        mockAgentManager,
        mockSessionManager as any
      )

      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        // No session_id provided
      }

      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
      }

      // Mock agent existence
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
      } as any)

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await toolWithSession.execute(params)

      // Should have _meta.session_id in response
      expect(result).toHaveProperty('_meta')
      expect(result._meta).toHaveProperty('session_id')
      expect(typeof result._meta?.session_id).toBe('string')
      expect(result._meta?.session_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )

      // Should have saved session with auto-generated ID
      expect(mockSessionManager.saveSession).toHaveBeenCalledWith(
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        expect.anything(),
        expect.anything()
      )
    })

    it('should use provided session_id instead of auto-generating', async () => {
      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(null),
        saveSession: vi.fn().mockResolvedValue(undefined),
      }

      const toolWithSession = new RunAgentTool(
        mockAgentExecutor,
        mockAgentManager,
        mockSessionManager as any
      )

      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        session_id: 'my-custom-session',
      }

      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
      }

      // Mock agent existence
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
      } as any)

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await toolWithSession.execute(params)

      // Should return the provided session_id
      expect(result._meta?.session_id).toBe('my-custom-session')

      // Should have saved with provided session_id
      expect(mockSessionManager.saveSession).toHaveBeenCalledWith(
        'my-custom-session',
        expect.anything(),
        expect.anything()
      )
    })

    it('should not auto-generate session_id when SessionManager is not available', async () => {
      const toolWithoutSession = new RunAgentTool(mockAgentExecutor, mockAgentManager, undefined)

      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        // No session_id provided
      }

      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await toolWithoutSession.execute(params)

      // Should not have _meta.session_id when SessionManager is not available
      expect(result._meta).toBeUndefined()
    })

    it('should include session_id in both _meta and structuredContent', async () => {
      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(null),
        saveSession: vi.fn().mockResolvedValue(undefined),
      }

      const toolWithSession = new RunAgentTool(
        mockAgentExecutor,
        mockAgentManager,
        mockSessionManager as any
      )

      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        session_id: 'test-session-123',
      }

      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
      }

      // Mock agent existence
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
      } as any)

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await toolWithSession.execute(params)

      // Both locations should have session_id
      expect(result._meta?.session_id).toBe('test-session-123')
      expect(result.structuredContent).toHaveProperty('sessionId', 'test-session-123')
    })
  })

  describe('extractAgentContent', () => {
    // Helper functions for testing (will be implemented in RunAgentTool.ts)
    const isRecord = (value: unknown): value is Record<string, unknown> => {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    const isStringField = (value: unknown): value is string => {
      return typeof value === 'string'
    }

    const extractAgentContent = (
      resultJson: unknown,
      isError: boolean,
      stdout: string,
      stderr: string
    ): string => {
      if (!isRecord(resultJson)) {
        return stdout || stderr || 'No output'
      }

      const primaryField = isError ? 'error' : 'result'

      if (isStringField(resultJson[primaryField])) {
        return resultJson[primaryField]
      }

      if (isStringField(resultJson.content)) {
        return resultJson.content
      }

      return stdout || stderr || 'No output'
    }

    describe('cursor-agent success case', () => {
      it('should extract result field from cursor-agent success response', () => {
        const resultJson = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Hello from cursor-agent',
          session_id: '34c9e294-f79d-415a-9ff5-a0ce813f90c2',
          request_id: '48b09f81-94c1-45e8-aa9f-e7d809015edb',
        }

        const content = extractAgentContent(resultJson, false, '', '')

        expect(content).toBe('Hello from cursor-agent')
      })
    })

    describe('cursor-agent error case', () => {
      it('should extract error field from cursor-agent error response', () => {
        const resultJson = {
          type: 'result',
          subtype: 'error',
          is_error: true,
          error: 'File not found',
          error_type: 'execution_error',
          session_id: '34c9e294-f79d-415a-9ff5-a0ce813f90c2',
          request_id: '48b09f81-94c1-45e8-aa9f-e7d809015edb',
        }

        const content = extractAgentContent(resultJson, true, '', '')

        expect(content).toBe('File not found')
      })
    })

    describe('claude code success case', () => {
      it('should extract result field from claude code success response', () => {
        const resultJson = {
          type: 'result',
          is_error: false,
          result: 'Hello from Claude Code',
          session_id: 'db3bd3f1-cf5a-47cd-9d17-ad03b13ec652',
          usage: {},
          uuid: 'cc980059-f6fe-4d7d-9a62-25aa82ba913f',
        }

        const content = extractAgentContent(resultJson, false, '', '')

        expect(content).toBe('Hello from Claude Code')
      })
    })

    describe('claude code error case (content field)', () => {
      it('should extract content field from claude code error response', () => {
        const resultJson = {
          is_error: true,
          content: '<error>File does not exist</error>',
        }

        const content = extractAgentContent(resultJson, true, '', '')

        expect(content).toBe('<error>File does not exist</error>')
      })
    })

    describe('fallback to stdout/stderr', () => {
      it('should fallback to stdout when resultJson is not a record', () => {
        const content = extractAgentContent(null, false, 'stdout content', 'stderr content')

        expect(content).toBe('stdout content')
      })

      it('should fallback to stderr when stdout is empty', () => {
        const content = extractAgentContent(null, false, '', 'stderr content')

        expect(content).toBe('stderr content')
      })

      it('should return "No output" when all sources are empty', () => {
        const content = extractAgentContent(null, false, '', '')

        expect(content).toBe('No output')
      })

      it('should fallback to stdout when result field is missing', () => {
        const resultJson = {
          type: 'result',
          is_error: false,
        }

        const content = extractAgentContent(resultJson, false, 'fallback stdout', '')

        expect(content).toBe('fallback stdout')
      })
    })

    describe('content field fallback', () => {
      it('should use content field when result field is missing (success case)', () => {
        const resultJson = {
          type: 'result',
          is_error: false,
          content: 'Content field value',
        }

        const content = extractAgentContent(resultJson, false, '', '')

        expect(content).toBe('Content field value')
      })

      it('should prioritize error field over content field (error case)', () => {
        const resultJson = {
          is_error: true,
          error: 'Error message',
          content: 'Content field value',
        }

        const content = extractAgentContent(resultJson, true, '', '')

        expect(content).toBe('Error message')
      })
    })
  })

  describe('isAgentError', () => {
    const isAgentError = (resultJson: unknown, exitCode: number): boolean => {
      const isRecord = (value: unknown): value is Record<string, unknown> => {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
      }

      if (isRecord(resultJson) && resultJson.is_error === true) {
        return true
      }

      return exitCode !== 0 && exitCode !== 143 && exitCode !== 124
    }

    describe('is_error flag priority', () => {
      it('should return true when is_error is true (exitCode=0)', () => {
        const resultJson = { is_error: true }

        const isError = isAgentError(resultJson, 0)

        expect(isError).toBe(true)
      })

      it('should return false when is_error is false (exitCode=0)', () => {
        const resultJson = { is_error: false }

        const isError = isAgentError(resultJson, 0)

        expect(isError).toBe(false)
      })
    })

    describe('exitCode fallback', () => {
      it('should return true when exitCode is 1 (no is_error field)', () => {
        const resultJson = {}

        const isError = isAgentError(resultJson, 1)

        expect(isError).toBe(true)
      })

      it('should return false when exitCode is 0 (no is_error field)', () => {
        const resultJson = {}

        const isError = isAgentError(resultJson, 0)

        expect(isError).toBe(false)
      })

      it('should return false for exitCode 143 (SIGTERM, normal termination)', () => {
        const resultJson = {}

        const isError = isAgentError(resultJson, 143)

        expect(isError).toBe(false)
      })

      it('should return false for exitCode 124 (timeout with partial result)', () => {
        const resultJson = {}

        const isError = isAgentError(resultJson, 124)

        expect(isError).toBe(false)
      })
    })

    describe('non-record resultJson', () => {
      it('should fallback to exitCode when resultJson is null', () => {
        const isError = isAgentError(null, 1)

        expect(isError).toBe(true)
      })

      it('should fallback to exitCode when resultJson is undefined', () => {
        const isError = isAgentError(undefined, 0)

        expect(isError).toBe(false)
      })
    })
  })
})
