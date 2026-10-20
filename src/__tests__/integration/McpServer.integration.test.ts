import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../../config/ServerConfig.js'
import { McpServer } from '../../server/McpServer.js'
import type { MockChildProcess, SpawnMock } from '../helpers/child-process-mock.js'

const mockSpawn: SpawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

/** A spawn double that prints `stdout` and exits with `exitCode`. */
function processPrinting(stdout: string, exitCode: number): MockChildProcess {
  return {
    stdin: { end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          callback(Buffer.from(stdout))
        }
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        callback(exitCode)
      }
    }),
    kill: vi.fn(),
  }
}

/** A spawn double whose agent reports a successful result on stdout. */
function succeedingProcess(resultText: string): MockChildProcess {
  return processPrinting(`${JSON.stringify({ type: 'result', result: resultText })}\n`, 0)
}

describe('McpServer Integration', () => {
  let server: McpServer
  let mockConfig: ServerConfig
  let testAgentsDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSpawn.mockImplementation(() => succeedingProcess('Agent finished the task'))

    testAgentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-server-integration-'))
    await fs.writeFile(
      path.join(testAgentsDir, 'test-agent.md'),
      '# Test Agent\nAn agent used by the integration tests.\n'
    )

    mockConfig = {
      serverName: 'test-mcp-server',
      serverVersion: '1.0.0',
      agentsDir: testAgentsDir,
      logLevel: 'info',
      agentType: 'cursor',
      agentPermission: 'safe-edit',
      agentModel: undefined,
      agentEffort: undefined,
      executionTimeoutMs: 300000,
      sessionEnabled: false,
      sessionDir: '.mcp-sessions',
      sessionRetentionDays: 1,
      agentsSettingsPath: undefined,
      cursorApiKey: undefined,
      glmApiKey: undefined,
      kimiApiKey: undefined,
    }
  })

  afterEach(async () => {
    if (server) {
      await server.close()
    }
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  describe('tool registration', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should have correct run_agent tool schema', async () => {
      const tools = await server.listTools()
      const runAgentTool = tools.find((tool) => tool.name === 'run_agent')

      expect(runAgentTool?.inputSchema.type).toBe('object')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('agent')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('prompt')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('cwd')
      expect(runAgentTool?.inputSchema.properties).toHaveProperty('session_id')
      // extra_args was accepted but never reached the CLI, so it is no longer advertised.
      expect(runAgentTool?.inputSchema.properties).not.toHaveProperty('extra_args')
      expect(runAgentTool?.inputSchema.required).toEqual(['agent', 'prompt', 'cwd'])
    })
  })

  describe('agent resources', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should publish agent list resource', async () => {
      const resources = await server.listResources()

      const agentListResource = resources.find((resource) => resource.uri === 'agents://list')
      expect(agentListResource?.name).toBe('Agent List')
      expect(agentListResource?.description).toContain('List of available Claude Code sub-agents')
    })

    it('should provide individual agent resources with valid URI format', async () => {
      const resources = await server.listResources()

      const agentResources = resources.filter(
        (resource) => resource.uri.startsWith('agents://') && resource.uri !== 'agents://list'
      )

      // Guards the loop below from passing vacuously when discovery finds nothing.
      expect(agentResources).not.toHaveLength(0)
      expect(agentResources.map((resource) => resource.uri)).toContain('agents://test-agent')

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
      const params = {
        agent: 'test-agent',
        prompt: 'Hello, world!',
        cwd: process.cwd(),
      }

      const result = await server.callTool('run_agent', params)

      // An error response also carries `content`, so the success criteria have to
      // be asserted explicitly rather than inferred from the response existing.
      expect(result.isError).toBe(false)
      expect(result.structuredContent).toMatchObject({
        status: 'success',
        agent: 'test-agent',
        exit_code: 0,
      })

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('Agent finished the task')
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })
  })

  describe('backend run outcomes', () => {
    it.each([
      {
        agentType: 'mcode',
        stdout: '{"type":"exec.result","status":"succeeded","output":"DONE"}\n',
        exitCode: 0,
        status: 'success',
        text: 'DONE',
      },
      {
        agentType: 'mcode',
        stdout:
          '{"type":"exec.result","status":"failed","error":{"category":"runtime","message":"Model is not available"}}\n',
        exitCode: 4,
        status: 'error',
        text: 'Model is not available',
      },
      {
        // Pi exits 0 after provider errors.
        agentType: 'pi',
        stdout:
          '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"OpenAI API error (404)"}}\n' +
          '{"type":"agent_settled","aborted":false}\n',
        exitCode: 0,
        status: 'error',
        text: 'OpenAI API error (404)',
      },
    ] as const)(
      'should report $agentType $status through run_agent',
      async ({ agentType, stdout, exitCode, status, text }) => {
        mockSpawn.mockImplementation(() => processPrinting(stdout, exitCode))
        server = new McpServer({ ...mockConfig, agentType })

        const result = await server.callTool('run_agent', {
          agent: 'test-agent',
          prompt: 'x',
          cwd: process.cwd(),
        })

        expect(result.isError).toBe(status === 'error')
        expect(result.structuredContent).toMatchObject({ status, exit_code: exitCode })
        expect(result.content.find((c) => c.type === 'text')?.text).toContain(text)
      }
    )
  })

  describe('resource access', () => {
    beforeEach(() => {
      server = new McpServer(mockConfig)
    })

    it('should provide agent list resource content', async () => {
      const resource = await server.readResource('agents://list')

      expect(resource.contents).toHaveLength(1)
      expect(resource.contents[0]?.type).toBe('text')
      expect(resource.contents[0]?.text).toContain('## test-agent')
      expect(resource.contents[0]?.text).toContain('agents://test-agent')
    })

    it('should provide individual agent resource content', async () => {
      const resource = await server.readResource('agents://test-agent')

      expect(resource.contents).toHaveLength(1)
      expect(resource.contents[0]?.type).toBe('text')
      expect(resource.contents[0]?.text).toContain('# Agent: test-agent')
      expect(resource.contents[0]?.text).toContain('An agent used by the integration tests.')
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
  })

  describe('session management wiring', () => {
    it('should hand back a session_id only when sessions are enabled', async () => {
      const params = { agent: 'test-agent', prompt: 'Hello', cwd: process.cwd() }

      // Whether a SessionManager was built is only observable through the
      // response, so that is what is asserted rather than the private field.
      const withoutSessions = new McpServer(mockConfig)
      try {
        const result = await withoutSessions.callTool('run_agent', params)
        expect(result._meta).toBeUndefined()
        expect(result.structuredContent).not.toHaveProperty('session_id')
      } finally {
        await withoutSessions.close()
      }

      const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-server-sessions-'))
      const withSessions = new McpServer({ ...mockConfig, sessionEnabled: true, sessionDir })
      try {
        const result = await withSessions.callTool('run_agent', params)
        expect(result._meta?.session_id).toEqual(expect.any(String))
        expect(result.structuredContent).toHaveProperty('session_id')
      } finally {
        await withSessions.close()
        await fs.rm(sessionDir, { recursive: true, force: true })
      }
    })
  })
})
