import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentManager } from '../../agents/AgentManager.js'
import type { ServerConfig } from '../../config/ServerConfig.js'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import { SessionManager } from '../../session/SessionManager.js'
import { RunAgentTool } from '../../tools/RunAgentTool.js'

/**
 * A real SessionManager with its I/O stubbed out, so the tool under test sees
 * the genuine type while the filesystem stays untouched.
 */
function createStubSessionManager(): SessionManager {
  const sessionManager = new SessionManager({
    enabled: true,
    sessionDir: path.join(os.tmpdir(), `run-agent-tool-${randomUUID()}`),
    retentionDays: 1,
  })
  vi.spyOn(sessionManager, 'loadSession').mockResolvedValue(null)
  vi.spyOn(sessionManager, 'saveSession').mockResolvedValue({ saved: true })
  vi.spyOn(sessionManager, 'cleanupOldSessions').mockResolvedValue(undefined)
  return sessionManager
}

describe('RunAgentTool', () => {
  let runAgentTool: RunAgentTool
  let mockAgentExecutor: AgentExecutor
  let mockAgentManager: AgentManager
  let mockConfig: ServerConfig

  beforeEach(() => {
    mockConfig = {
      serverName: 'test-server',
      serverVersion: '1.0.0',
      agentsDir: './test-agents',
      agentType: 'cursor',
      agentPermission: 'safe-edit',
      agentModel: undefined,
      agentEffort: undefined,
      logLevel: 'info',
      executionTimeoutMs: 300000,
      sessionEnabled: false,
      sessionDir: '.mcp-sessions',
      sessionRetentionDays: 1,
      agentsSettingsPath: undefined,
      cursorApiKey: undefined,
      glmApiKey: undefined,
      kimiApiKey: undefined,
    }

    const executionConfig = createExecutionConfig('cursor')
    mockAgentExecutor = new AgentExecutor(executionConfig)
    mockAgentManager = new AgentManager(mockConfig)

    runAgentTool = new RunAgentTool(mockAgentExecutor, mockAgentManager)
  })

  describe('parameter validation', () => {
    it.each([
      {
        label: 'a missing agent',
        args: { prompt: 'Test prompt', cwd: process.cwd() },
        error: /agent.*required|missing.*agent/i,
      },
      {
        label: 'an empty agent',
        args: { agent: '', prompt: 'Test prompt', cwd: process.cwd() },
        error: /agent.*required|invalid.*agent/i,
      },
      {
        label: 'a missing prompt',
        args: { agent: 'test-agent', cwd: process.cwd() },
        error: /prompt.*required|missing.*prompt/i,
      },
      {
        label: 'an empty prompt',
        args: { agent: 'test-agent', prompt: '', cwd: process.cwd() },
        error: /prompt.*required|invalid.*prompt/i,
      },
      {
        label: 'an empty session_id',
        args: { agent: 'test-agent', prompt: 'Test prompt', cwd: process.cwd(), session_id: '' },
        error: /session.*id.*empty|invalid.*session/i,
      },
      {
        label: 'a session_id with invalid characters',
        args: {
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: process.cwd(),
          session_id: 'session/with/../invalid',
        },
        error: /session.*id.*invalid.*characters/i,
      },
      {
        label: 'a session_id that is too long',
        args: {
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: process.cwd(),
          session_id: 'a'.repeat(101),
        },
        error: /session.*id.*too long/i,
      },
      {
        label: 'a cwd containing ..',
        args: { agent: 'test-agent', prompt: 'Test prompt', cwd: '/tmp/project/../../etc' },
        error: /Invalid working directory path/,
      },
    ])('should reject $label without executing the agent', async ({ args, error }) => {
      const executeAgent = vi.spyOn(mockAgentExecutor, 'executeAgent')

      const result = await runAgentTool.execute(args)

      expect(result.isError).toBe(true)
      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toMatch(error)
      expect(executeAgent).not.toHaveBeenCalled()
    })
  })

  describe('agent execution', () => {
    beforeEach(() => {
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

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('Agent execution result')
      expect(result.isError).toBe(false)
    })

    it('should return normalized agent errors without nested raw JSON', async () => {
      const params = {
        agent: 'failing-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }
      const errorMessage = 'UnknownError: Provider failed (ref: error-ref, sessionID: session-123)'

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: '{"type":"error"}',
        stderr: '',
        exitCode: 1,
        executionTime: 50,
        hasResult: true,
        resultJson: {
          type: 'result',
          subtype: 'error',
          is_error: true,
          error: errorMessage,
          error_type: 'UnknownError',
          error_ref: 'error-ref',
          session_id: 'session-123',
        },
      })

      const result = await runAgentTool.execute(params)
      const textContent = result.content.find((content) => content.type === 'text')
      const parsedContent = JSON.parse(textContent?.text || '{}')

      expect(result.isError).toBe(true)
      expect(parsedContent).toMatchObject({
        result: errorMessage,
        exit_code: 1,
        status: 'error',
      })
      expect(parsedContent.result).not.toContain('{"type":"error"}')
    })
  })

  describe('nonexistent agent handling', () => {
    it('should handle nonexistent agent gracefully', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }

      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue(undefined)

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.error).toMatch(/agent.*not found|nonexistent.*agent/i)
    })

    it('should include available agents in error message', async () => {
      const params = {
        agent: 'nonexistent-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }

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
      const parsedContent = JSON.parse(textContent?.text || '{}')
      expect(parsedContent.result).toContain('Detailed output')
      expect(result.structuredContent).toHaveProperty('agent', 'test-agent')
      expect(result.structuredContent).toHaveProperty('exit_code', 0)
      expect(result.structuredContent).toHaveProperty('execution_time', 250)
      expect(result.structuredContent).toHaveProperty('result')
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

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockRejectedValue(
        new Error('Execution failed unexpectedly')
      )

      const result = await runAgentTool.execute(params)

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toMatch(/error|failed/i)
    })

    it('should handle agent manager errors gracefully', async () => {
      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }

      vi.spyOn(mockAgentManager, 'getAgent').mockRejectedValue(new Error('Failed to load agent'))

      const result = await runAgentTool.execute(params)

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

    it.each([
      {
        exitCode: 0,
        hasResult: false,
        resultJson: undefined,
        stdout: 'Normal output',
        stderr: '',
        status: 'success',
        isError: false,
        resultText: 'Normal output',
      },
      {
        exitCode: 0,
        hasResult: true,
        resultJson: {
          type: 'result',
          result: 'Progress only',
          status: 'partial',
          stop_reason: 'Cancelled',
        },
        stdout: '',
        stderr: '',
        status: 'partial',
        isError: false,
        resultText: 'Progress only',
      },
      {
        exitCode: 1,
        hasResult: false,
        resultJson: undefined,
        stdout: '',
        stderr: 'Agent execution failed',
        status: 'error',
        isError: true,
        resultText: 'Agent execution failed',
      },
      {
        exitCode: 8,
        hasResult: true,
        resultJson: {
          type: 'result',
          result: 'Work in progress',
          status: 'partial',
          stop_reason: 'max_turns',
        },
        stdout: '',
        stderr: 'Maximum turns reached',
        status: 'partial',
        isError: false,
        resultText: 'Work in progress',
      },
      {
        exitCode: 124,
        hasResult: false,
        resultJson: undefined,
        stdout: '',
        stderr: 'Execution timeout: 300000ms',
        status: 'error',
        isError: true,
        resultText: 'Execution timeout: 300000ms',
      },
      {
        exitCode: 137,
        hasResult: true,
        resultJson: { type: 'result', result: 'Completed' },
        stdout: '',
        stderr: '',
        status: 'success',
        isError: false,
        resultText: 'Completed',
      },
      {
        exitCode: 143,
        hasResult: true,
        resultJson: {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          status: 'error',
          error: 'Authentication required',
        },
        stdout: '',
        stderr: '',
        status: 'error',
        isError: true,
        resultText: 'Authentication required',
      },
    ])(
      'should report status=$status and isError=$isError for exit code $exitCode with hasResult=$hasResult',
      async ({ exitCode, hasResult, resultJson, stdout, stderr, status, isError, resultText }) => {
        vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
          stdout,
          stderr,
          exitCode,
          executionTime: 100,
          hasResult,
          resultJson,
        })

        const result = await runAgentTool.execute({
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: process.cwd(),
        })
        const textContent = result.content.find((c) => c.type === 'text')
        const expected = { result: resultText, exit_code: exitCode, status }

        expect(result.isError).toBe(isError)
        expect(JSON.parse(textContent?.text || '{}')).toMatchObject(expected)
        expect(result.structuredContent).toMatchObject(expected)
      }
    )

    it('should keep the failure reason when the agent also produced stdout', async () => {
      const params = { agent: 'test-agent', prompt: 'Test', cwd: process.cwd() }

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: 'partial progress before the timeout',
        stderr: 'Execution timeout: 300000ms',
        exitCode: 124,
        executionTime: 300000,
        hasResult: false,
        resultJson: undefined,
      })

      const result = await runAgentTool.execute(params)
      const text = result.content.find((c) => c.type === 'text')?.text ?? ''

      expect(text).toContain('partial progress before the timeout')
      expect(text).toContain('Execution timeout: 300000ms')
    })

    it('should tell the caller to start a new session when the prompt exceeds argv limits', async () => {
      const toolWithSession = new RunAgentTool(
        mockAgentExecutor,
        mockAgentManager,
        createStubSessionManager()
      )

      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
        filePath: '/test-agents/test-agent.md',
        lastModified: new Date('2025-01-01'),
      })
      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: '',
        stderr:
          'The prompt is too large to pass to the "cursor-agent" CLI: 1100000 bytes exceeds this operating system\'s argument limit.',
        exitCode: 1,
        executionTime: 5,
        hasResult: false,
        failureReason: 'argv_too_long',
      })

      const result = await toolWithSession.execute({
        agent: 'test-agent',
        prompt: 'Continue',
        cwd: process.cwd(),
        session_id: 'overgrown-session',
      })

      const text = result.content.find((c) => c.type === 'text')?.text ?? ''
      expect(result.isError).toBe(true)
      expect(text).toContain('too large')
      expect(text).toContain('overgrown-session')
      expect(text).toContain('without session_id')
    })
  })

  describe('session ID auto-generation', () => {
    it('should auto-generate session_id when not provided and SessionManager is available', async () => {
      const mockSessionManager = createStubSessionManager()

      const toolWithSession = new RunAgentTool(
        mockAgentExecutor,
        mockAgentManager,
        mockSessionManager
      )

      const params = {
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      }

      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
      }

      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
        filePath: '/test-agents/test-agent.md',
        lastModified: new Date('2025-01-01'),
      })

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await toolWithSession.execute(params)

      expect(result).toHaveProperty('_meta')
      expect(result._meta).toHaveProperty('session_id')
      expect(typeof result._meta?.session_id).toBe('string')
      expect(result._meta?.session_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )

      expect(mockSessionManager.saveSession).toHaveBeenCalledWith(
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        expect.anything(),
        expect.anything()
      )
    })

    it('should use provided session_id instead of auto-generating', async () => {
      const mockSessionManager = createStubSessionManager()

      const toolWithSession = new RunAgentTool(
        mockAgentExecutor,
        mockAgentManager,
        mockSessionManager
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

      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
        filePath: '/test-agents/test-agent.md',
        lastModified: new Date('2025-01-01'),
      })

      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue(mockResult)

      const result = await toolWithSession.execute(params)

      expect(result._meta?.session_id).toBe('my-custom-session')
      expect(result.structuredContent).toHaveProperty('session_id', 'my-custom-session')

      expect(mockSessionManager.saveSession).toHaveBeenCalledWith(
        'my-custom-session',
        expect.anything(),
        expect.anything()
      )
    })

    it.each([
      { label: 'a provided', sessionId: { session_id: 'user-supplied-session' } },
      { label: 'no', sessionId: {} },
    ])(
      'should return no session_id for $label session_id when sessions are disabled',
      async ({ sessionId }) => {
        const toolWithoutSession = new RunAgentTool(mockAgentExecutor, mockAgentManager, undefined)

        vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
          name: 'test-agent',
          description: 'Test agent',
          content: 'Test agent content',
          filePath: '/test/agents/test-agent.md',
          lastModified: new Date(),
        })
        vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
          stdout: 'Success',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          hasResult: false,
          resultJson: undefined,
        })

        const result = await toolWithoutSession.execute({
          agent: 'test-agent',
          prompt: 'Test prompt',
          cwd: process.cwd(),
          ...sessionId,
        })

        expect(result.isError).toBe(false)
        // Nothing was stored, so no id may come back looking continuable.
        expect(result._meta).toBeUndefined()
        expect(result.structuredContent).not.toHaveProperty('session_id')
      }
    )

    it('should tell the caller when the exchange could not be saved to the session', async () => {
      const sessionManager = createStubSessionManager()
      vi.spyOn(sessionManager, 'saveSession').mockResolvedValue({
        saved: false,
        reason: 'EACCES: permission denied',
      })
      const toolWithSession = new RunAgentTool(mockAgentExecutor, mockAgentManager, sessionManager)

      vi.spyOn(mockAgentManager, 'getAgent').mockResolvedValue({
        name: 'test-agent',
        description: 'Test agent',
        content: 'test content',
        filePath: '/test-agents/test-agent.md',
        lastModified: new Date('2025-01-01'),
      })
      vi.spyOn(mockAgentExecutor, 'executeAgent').mockResolvedValue({
        stdout: 'Agent output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        hasResult: false,
        resultJson: undefined,
      })

      const result = await toolWithSession.execute({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
        session_id: 'unwritable-session',
      })

      // The agent's own result still stands...
      expect(result.isError).toBe(false)
      expect(result.structuredContent).toMatchObject({ status: 'success', session_saved: false })
      // ...but the caller is told the history behind session_id is missing.
      const text = result.content.find((c) => c.type === 'text')?.text ?? ''
      expect(text).toContain('Agent output')
      expect(text).toContain('was not saved')
      expect(text).toContain('unwritable-session')
    })
  })
})
