import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { ServerConfig } from '../../config/ServerConfig.js'
import { McpServer } from '../../server/McpServer.js'
import type { SpawnMock } from '../helpers/child-process-mock.js'

const mockSpawn: SpawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

describe('Critical User Journeys - E2E Tests', () => {
  let server: McpServer
  let config: ServerConfig
  let testAgentsDir: string

  beforeAll(async () => {
    vi.clearAllMocks()

    mockSpawn.mockImplementation((_cmd, args) => {
      const prompt = (args.includes('-p') ? args[args.indexOf('-p') + 1] : '') ?? ''
      const isTestAgent = prompt.includes('test-agent') || args.includes('test-agent')
      const isPerformanceAgent =
        prompt.includes('performance-agent') || args.includes('performance-agent')

      return {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              if (isTestAgent) {
                callback(Buffer.from('{"type": "result", "result": "E2E test successful"}\n'))
              } else if (isPerformanceAgent) {
                callback(Buffer.from('{"type": "result", "result": "Performance test complete"}\n'))
              } else {
                callback(
                  Buffer.from('{"type": "result", "result": "Agent executed successfully"}\n')
                )
              }
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0)
          }
        }),
        kill: vi.fn(),
      }
    })

    testAgentsDir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-e2e-test-agents-'))

    await fs.writeFile(
      path.join(testAgentsDir, 'test-agent.md'),
      `# Test Agent\n\nA simple test agent for E2E testing.\n\nUsage: echo "Hello from test agent"`
    )

    await fs.writeFile(
      path.join(testAgentsDir, 'performance-agent.md'),
      `# Performance Agent\n\nAgent for performance testing.\n\nUsage: sleep 0.1 && echo "Performance test complete"`
    )

    vi.stubEnv('SERVER_NAME', 'e2e-test-server')
    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', 'kimi')
    vi.stubEnv('CLI_API_KEY', 'kimi-e2e-secret')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'inherited-anthropic-token')

    config = new ServerConfig()

    server = new McpServer(config)
    await server.start()
  })

  afterAll(async () => {
    if (server) {
      await server.close()
    }
    await fs.rm(testAgentsDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  test('User Journey 1: Server starts and is ready to accept requests', async () => {
    const tools = await server.listTools()

    expect(tools).toBeDefined()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0) // At least run_agent tool available
  })

  test('User Journey 2: Discover available agents', async () => {
    const resources = await server.listResources()

    expect(resources).toBeDefined()
    expect(Array.isArray(resources)).toBe(true)
    expect(resources.length).toBeGreaterThan(0)

    const agentListResource = resources.find((r) => r.uri === 'agents://list')
    expect(agentListResource).toBeDefined()
    expect(agentListResource?.name).toBe('Agent List')
  })

  test('User Journey 3: Execute an agent without leaking its API key into argv', async () => {
    const result = await server.callTool('run_agent', {
      agent: 'test-agent',
      prompt: 'Help me with this task',
      cwd: process.cwd(),
    })

    // An error response also has content, so success is asserted explicitly.
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toMatchObject({ status: 'success' })

    const spawnCall = mockSpawn.mock.calls.at(-1)
    expect(spawnCall).toBeDefined()
    if (!spawnCall) {
      throw new Error('Expected Kimi execution to spawn a child process')
    }
    const [command, args, options] = spawnCall
    expect(options.env).toBeDefined()
    if (!options.env) {
      throw new Error('Expected Kimi execution to provide a child environment')
    }
    expect(command).toBe('claude')
    expect(args).not.toContain('kimi-e2e-secret')
    expect(options.env['ANTHROPIC_BASE_URL']).toBe('https://api.kimi.com/coding/')
    expect(options.env['ANTHROPIC_API_KEY']).toBe('kimi-e2e-secret')
    expect(options.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
  })

  test('User Journey 5: Handle errors gracefully when things go wrong', async () => {
    const result1 = await server.callTool('run_agent', {
      agent: 'non-existent-agent',
      prompt: 'This should fail gracefully',
      cwd: process.cwd(),
    })

    expect(result1.content).toBeDefined()
    const textContent1 = result1.content.find((c) => c.type === 'text')
    expect(textContent1?.text).toMatch(/not found|Agent not found/i)

    const result2 = await server.callTool('run_agent', {
      agent: '', // Empty agent name
      prompt: 'This should also fail',
      cwd: process.cwd(),
    })

    expect(result2.content).toBeDefined()
    const textContent2 = result2.content.find((c) => c.type === 'text')
    expect(textContent2?.text).toMatch(/invalid|required/i)
  })
})
