/**
 * Focused tests for per-call timeout_ms and permission controls on run_agent.
 *
 * These tests cover the contract introduced for the per-call execution
 * boundary:
 * - schema additivity (AC1)
 * - timeout_ms and permission validation (AC2, AC3)
 * - per-call scope (subsequent calls revert to defaults) (AC4)
 * - session persistence excludes execution-only controls (AC5)
 * - invalid inputs short-circuit before spawn or session save (AC6)
 *
 * Tests pin behavior at the RunAgentTool boundary by spying on
 * AgentExecutor.executeAgent (the spawn boundary) and SessionManager.saveSession
 * (the persistence boundary).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentManager } from '../../agents/AgentManager.js'
import type { ServerConfig } from '../../config/ServerConfig.js'
import {
  AGENT_PERMISSIONS,
  AgentExecutor,
  createExecutionConfig,
  MAX_PER_CALL_TIMEOUT_MS,
} from '../../execution/AgentExecutor.js'
import { RunAgentTool } from '../../tools/RunAgentTool.js'

const baseConfig: ServerConfig = {
  serverName: 'test-server',
  serverVersion: '1.0.0',
  agentsDir: './test-agents',
  agentType: 'cursor',
  agentPermission: 'safe-edit',
  logLevel: 'info',
  executionTimeoutMs: 300000,
  sessionEnabled: false,
  sessionDir: '.mcp-sessions',
  sessionRetentionDays: 1,
  agentsSettingsPath: undefined,
  cursorApiKey: undefined,
}

function newRunAgentTool() {
  const executor = new AgentExecutor(createExecutionConfig('cursor'))
  const manager = new AgentManager(baseConfig)
  vi.spyOn(manager, 'getAgent').mockResolvedValue({
    name: 'test-agent',
    description: 'Test agent',
    content: 'Test agent content',
    filePath: '/test/agents/test-agent.md',
    lastModified: new Date(),
  })
  const executeSpy = vi.spyOn(executor, 'executeAgent').mockResolvedValue({
    stdout: 'ok',
    stderr: '',
    exitCode: 0,
    executionTime: 1,
    hasResult: false,
    resultJson: undefined,
  })
  const sessionManager = {
    loadSession: vi.fn().mockResolvedValue(null),
    saveSession: vi.fn().mockResolvedValue(undefined),
    cleanupOldSessions: vi.fn().mockResolvedValue(undefined),
  }
  const tool = new RunAgentTool(executor, manager, sessionManager as any)
  return { tool, executeSpy, sessionManager }
}

const validParams = {
  agent: 'test-agent',
  prompt: 'Test prompt',
  cwd: process.cwd(),
}

describe('RunAgentTool per-call controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC1: schema exposes optional timeout_ms and permission additively', () => {
    it('declares timeout_ms and permission alongside existing optional fields', () => {
      const { tool } = newRunAgentTool()
      const schema = tool.inputSchema

      // Existing required + optional contract is preserved.
      expect(schema.required).toEqual(['agent', 'prompt', 'cwd'])
      for (const key of ['agent', 'prompt', 'cwd', 'extra_args', 'session_id']) {
        expect(schema.properties).toHaveProperty(key)
      }

      // New optional fields are present and not in `required`.
      expect(schema.properties).toHaveProperty('timeout_ms')
      expect(schema.properties).toHaveProperty('permission')
      expect(schema.required).not.toContain('timeout_ms')
      expect(schema.required).not.toContain('permission')

      // Schema declares the per-call ceiling and permission enum so MCP
      // clients receive the contract directly.
      const timeoutMsSchema = schema.properties['timeout_ms'] as Record<string, unknown>
      expect(timeoutMsSchema['type']).toBe('integer')
      expect(timeoutMsSchema['minimum']).toBe(1)
      expect(timeoutMsSchema['maximum']).toBe(MAX_PER_CALL_TIMEOUT_MS)

      const permissionSchema = schema.properties['permission'] as Record<string, unknown>
      expect(permissionSchema['type']).toBe('string')
      expect(permissionSchema['enum']).toEqual(AGENT_PERMISSIONS)
    })

    it('keeps the minimal required-only call backwards compatible', async () => {
      const { tool, executeSpy, sessionManager } = newRunAgentTool()

      const result = await tool.execute({ ...validParams })

      expect(result.isError).not.toBe(true)
      expect(executeSpy).toHaveBeenCalledTimes(1)
      // No overrides means the second arg is either omitted or empty object.
      const overrides = executeSpy.mock.calls[0][1]
      expect(overrides ?? {}).toEqual({})
      expect(sessionManager.saveSession).toHaveBeenCalled()
    })
  })

  describe('AC2: timeout_ms validation', () => {
    it('accepts a valid positive integer within the documented bound', async () => {
      const { tool, executeSpy } = newRunAgentTool()

      const result = await tool.execute({ ...validParams, timeout_ms: 60_000 })

      expect(result.isError).not.toBe(true)
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'Test agent content' }),
        expect.objectContaining({ timeoutMs: 60_000 })
      )
    })

    it('falls back to default when timeout_ms is omitted', async () => {
      const { tool, executeSpy } = newRunAgentTool()

      await tool.execute({ ...validParams })

      const overrides = executeSpy.mock.calls[0][1]
      expect(overrides?.timeoutMs).toBeUndefined()
    })

    it.each([
      { label: 'non-integer', value: 1500.5 },
      { label: 'negative', value: -1000 },
      { label: 'zero', value: 0 },
      { label: 'string', value: '5000' as unknown as number },
      { label: 'NaN', value: Number.NaN },
      { label: 'Infinity', value: Number.POSITIVE_INFINITY },
      { label: 'too-large', value: MAX_PER_CALL_TIMEOUT_MS + 1 },
    ])('rejects $label timeout_ms', async ({ value }) => {
      const { tool, executeSpy, sessionManager } = newRunAgentTool()

      const result = await tool.execute({ ...validParams, timeout_ms: value })

      expect(result.isError).toBe(true)
      const text = result.content.find((c) => c.type === 'text')?.text ?? ''
      expect(text).toMatch(/timeout_ms/i)
      expect(executeSpy).not.toHaveBeenCalled()
      expect(sessionManager.saveSession).not.toHaveBeenCalled()
    })
  })

  describe('AC3: permission validation', () => {
    it.each(AGENT_PERMISSIONS)('accepts valid permission %s', async (perm) => {
      const { tool, executeSpy } = newRunAgentTool()

      const result = await tool.execute({ ...validParams, permission: perm })

      expect(result.isError).not.toBe(true)
      expect(executeSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ permission: perm })
      )
    })

    it('falls back to default when permission is omitted', async () => {
      const { tool, executeSpy } = newRunAgentTool()

      await tool.execute({ ...validParams })

      const overrides = executeSpy.mock.calls[0][1]
      expect(overrides?.permission).toBeUndefined()
    })

    it.each([
      { label: 'unknown string', value: 'admin' },
      { label: 'empty string', value: '' },
      { label: 'wrong case', value: 'Read-Only' },
      { label: 'number', value: 1 as unknown as string },
      { label: 'null', value: null as unknown as string },
    ])('rejects invalid permission ($label)', async ({ value }) => {
      const { tool, executeSpy, sessionManager } = newRunAgentTool()

      const result = await tool.execute({ ...validParams, permission: value })

      expect(result.isError).toBe(true)
      const text = result.content.find((c) => c.type === 'text')?.text ?? ''
      expect(text).toMatch(/permission/i)
      expect(executeSpy).not.toHaveBeenCalled()
      expect(sessionManager.saveSession).not.toHaveBeenCalled()
    })
  })

  describe('AC4: per-call overrides do not mutate server-wide config', () => {
    it('next call reverts to defaults when overrides are omitted', async () => {
      const { tool, executeSpy } = newRunAgentTool()

      await tool.execute({
        ...validParams,
        timeout_ms: 90_000,
        permission: 'yolo',
      })
      await tool.execute({ ...validParams })

      expect(executeSpy).toHaveBeenCalledTimes(2)
      const firstOverrides = executeSpy.mock.calls[0][1] ?? {}
      const secondOverrides = executeSpy.mock.calls[1][1] ?? {}

      expect(firstOverrides).toEqual({ timeoutMs: 90_000, permission: 'yolo' })
      // Critical: the second call must NOT inherit either override.
      expect(secondOverrides).toEqual({})
    })

    it('different calls can carry different overrides without bleed-through', async () => {
      const { tool, executeSpy } = newRunAgentTool()

      await tool.execute({ ...validParams, timeout_ms: 5_000 })
      await tool.execute({ ...validParams, permission: 'read-only' })

      const firstOverrides = executeSpy.mock.calls[0][1] ?? {}
      const secondOverrides = executeSpy.mock.calls[1][1] ?? {}

      expect(firstOverrides).toEqual({ timeoutMs: 5_000 })
      expect(secondOverrides).toEqual({ permission: 'read-only' })
    })
  })

  describe('AC5: session persistence excludes execution-only controls', () => {
    it('saved session payload omits timeout_ms and permission', async () => {
      const { tool, sessionManager } = newRunAgentTool()

      await tool.execute({
        ...validParams,
        session_id: 'sess-1',
        timeout_ms: 90_000,
        permission: 'yolo',
      })

      expect(sessionManager.saveSession).toHaveBeenCalledTimes(1)
      const [, savedRequest] = sessionManager.saveSession.mock.calls[0]
      expect(savedRequest).toEqual({
        agent: 'test-agent',
        prompt: 'Test prompt',
        cwd: process.cwd(),
      })
      expect(savedRequest).not.toHaveProperty('timeout_ms')
      expect(savedRequest).not.toHaveProperty('permission')
    })

    it('continuation call with same session_id but no overrides does not replay them', async () => {
      const { tool, executeSpy, sessionManager } = newRunAgentTool()

      // First call sets overrides — they should NOT be persisted.
      await tool.execute({
        ...validParams,
        session_id: 'sess-2',
        timeout_ms: 45_000,
        permission: 'read-only',
      })

      // Simulate session-load on continuation. The saved history (per AC5)
      // never carries timeout_ms / permission, so loadSession returns a
      // payload whose history mirrors only what was saved.
      sessionManager.loadSession.mockResolvedValueOnce({
        sessionId: 'sess-2',
        agentType: 'test-agent',
        history: [
          {
            timestamp: new Date(),
            request: {
              agent: 'test-agent',
              prompt: 'Test prompt',
              cwd: process.cwd(),
            },
            response: {
              stdout: 'ok',
              stderr: '',
              exitCode: 0,
              executionTime: 1,
            },
          },
        ],
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
      })

      // Second call reuses session_id but omits both overrides.
      await tool.execute({
        ...validParams,
        session_id: 'sess-2',
      })

      expect(executeSpy).toHaveBeenCalledTimes(2)
      const continuationOverrides = executeSpy.mock.calls[1][1] ?? {}
      // Overrides MUST NOT be inherited from the previous call.
      expect(continuationOverrides).toEqual({})
    })
  })

  describe('AC6: invalid inputs short-circuit before spawn and session save', () => {
    it('invalid timeout_ms returns MCP error and never reaches executeAgent or saveSession', async () => {
      const { tool, executeSpy, sessionManager } = newRunAgentTool()

      const result = await tool.execute({
        ...validParams,
        session_id: 'sess-x',
        timeout_ms: -1,
      })

      expect(result.isError).toBe(true)
      expect(executeSpy).not.toHaveBeenCalled()
      expect(sessionManager.saveSession).not.toHaveBeenCalled()
    })

    it('invalid permission returns MCP error and never reaches executeAgent or saveSession', async () => {
      const { tool, executeSpy, sessionManager } = newRunAgentTool()

      const result = await tool.execute({
        ...validParams,
        session_id: 'sess-x',
        permission: 'super-user',
      })

      expect(result.isError).toBe(true)
      expect(executeSpy).not.toHaveBeenCalled()
      expect(sessionManager.saveSession).not.toHaveBeenCalled()
    })
  })
})
