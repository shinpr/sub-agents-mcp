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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toContain('Warning output')

      // structuredContent should have result field (ADR-0003)
      expect(result.structuredContent).toHaveProperty('result')
      expect((result.structuredContent as any).result).toContain('Warning output')
      // stderr is agent implementation detail and should NOT be in structuredContent
      expect(result.structuredContent).not.toHaveProperty('stderr')
    })

    it('should handle agent execution failure', async () => {
      const params = {
        agent: 'failing-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
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
      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toContain('failed')
      // exit code is in structured content with snake_case naming (ADR-0003)
      expect(result.structuredContent).toHaveProperty('exit_code', 1)
    })

    it('should include execution metadata in response', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
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
      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toContain('Success')
      // Metadata is in structured content with snake_case naming (ADR-0003)
      expect(result.structuredContent).toHaveProperty('execution_time', 300)
      expect(result.structuredContent).toHaveProperty('exit_code', 0)
    })
  })

  describe('nonexistent agent handling', () => {
    it('should handle nonexistent agent gracefully', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }

      // Mock agent not found
      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue(undefined)

      const result = await runAgentTool.execute(params)

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()

      const textContent = result.content.find((c) => c.type === 'text')
      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.error).toMatch(/agent.*not found|nonexistent.*agent/i)
    })

    it('should include available agents in error message', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
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
      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.available_agents).toContain('agent1')
      expect(parsedContent.available_agents).toContain('agent2')
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toContain('Detailed output')
      // MCP-managed metadata with snake_case naming (ADR-0003)
      expect(result.structuredContent).toHaveProperty('agent', 'test-agent')
      expect(result.structuredContent).toHaveProperty('exit_code', 0)
      expect(result.structuredContent).toHaveProperty('execution_time', 250)
      expect(result.structuredContent).toHaveProperty('result')
      // Agent implementation details should NOT be in structuredContent
      expect(result.structuredContent).not.toHaveProperty('stderr')
    })
  })

  describe('error handling', () => {
    it('should handle agent executor errors gracefully', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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

    it('should treat exit code 124 with hasResult=false as complete timeout', async () => {
      const params = {
        agent: 'timeout-agent',
        prompt: 'Test complete timeout',
        cwd: process.cwd(),
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

      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toBe('Execution timeout: 300000ms')
      expect(parsedContent.exit_code).toBe(124)
      expect(parsedContent.status).toBe('error')
      // Check error status in structuredContent with snake_case naming
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        exit_code: 124,
      })
    })

    it('should treat exit code 0 as success regardless of hasResult', async () => {
      const params = {
        agent: 'normal-agent',
        prompt: 'Test normal completion',
        cwd: process.cwd(),
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

      // content[0].text is now JSON string (ADR-0003)
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toBe('Normal output')
      expect(parsedContent.exit_code).toBe(0)
      expect(parsedContent.status).toBe('success')
      // Check success status in structuredContent with snake_case naming
      expect(result.structuredContent).toMatchObject({
        status: 'success',
        exit_code: 0,
      })
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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
        cwd: process.cwd(),
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

      // session_id in _meta and structuredContent (ADR-0003)
      expect(result._meta?.session_id).toBe('test-session-123')
      expect(result.structuredContent).toHaveProperty('session_id', 'test-session-123')
    })
  })
})
