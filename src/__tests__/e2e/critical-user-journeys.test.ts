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
  let testAgentsDir: string

  beforeAll(async () => {
    vi.clearAllMocks()

    mockSpawn.mockImplementation(() => ({
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('{"type": "result", "result": "E2E test successful"}\n'))
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
    }))

    testAgentsDir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-e2e-test-agents-'))

    await fs.writeFile(
      path.join(testAgentsDir, 'test-agent.md'),
      `# Test Agent\n\nA simple test agent for E2E testing.\n\nUsage: echo "Hello from test agent"`
    )

    vi.stubEnv('AGENTS_DIR', testAgentsDir)
    vi.stubEnv('AGENT_TYPE', 'kimi')
    vi.stubEnv('CLI_API_KEY', 'kimi-e2e-secret')

    server = new McpServer(new ServerConfig())
  })

  afterAll(async () => {
    if (server) {
      await server.close()
    }
    await fs.rm(testAgentsDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  test('User Journey 3: CLI_API_KEY from the environment reaches the spawned agent', async () => {
    await server.callTool('run_agent', {
      agent: 'test-agent',
      prompt: 'Help me with this task',
      cwd: process.cwd(),
    })

    const spawnCall = mockSpawn.mock.calls.at(-1)
    if (!spawnCall) {
      throw new Error('Expected Kimi execution to spawn a child process')
    }
    const [, , options] = spawnCall
    expect(options.env?.['ANTHROPIC_API_KEY']).toBe('kimi-e2e-secret')
  })
})
