import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { AgentManager } from '../../agents/AgentManager.js'
import { ServerConfig } from '../../config/ServerConfig.js'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import { McpServer } from '../../server/McpServer.js'
import type { SpawnMock } from '../helpers/child-process-mock.js'

const mockSpawn: SpawnMock = vi.hoisted(() =>
  vi.fn(() => ({
    stdin: { end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => {
            callback(
              Buffer.from(
                `${JSON.stringify({
                  type: 'assistant',
                  message: {
                    content: [{ type: 'text', text: 'Mock performance execution result' }],
                  },
                })}\n`
              )
            )
          }, 10)
        }
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: (code?: number) => void) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 50)
      } else if (event === 'exit') {
        setTimeout(() => callback(), 50)
      }
    }),
    kill: vi.fn(),
  }))
)

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('node:util', () => ({
  promisify: vi.fn((_fn) => {
    return (command: string, _options?: unknown) => {
      const agent = command.match(/([\w-]+):/)?.[1]

      if (agent === 'quick-agent') {
        return Promise.resolve({
          stdout: 'Quick execution',
          stderr: '',
        })
      }
      if (agent === 'medium-agent') {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              stdout: 'Medium execution',
              stderr: '',
            })
          }, 100)
        })
      }
      if (agent === 'large-output-agent') {
        const largeOutput = Array.from(
          { length: 1000 },
          (_, i) => `Line ${i + 1}: This is a test line with substantial content`
        ).join('\n')
        return Promise.resolve({
          stdout: largeOutput,
          stderr: '',
        })
      }

      return Promise.resolve({
        stdout: 'Default output',
        stderr: '',
      })
    }
  }),
}))

// Renamed from a performance suite: spawn is mocked here, so wall-clock numbers
// only measured the mock. What remains are the behaviours those tests relied on.
describe('Execution behaviour under load', () => {
  let testAgentsDir: string
  let server: McpServer
  let config: ServerConfig
  let agentManager: AgentManager
  let agentExecutor: AgentExecutor

  beforeAll(async () => {
    vi.clearAllMocks()

    mockSpawn.mockImplementation((_cmd, args) => {
      const mockChildProcess = {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              const isLargeOutputAgent = args.some((arg) => arg.includes('large-output-agent'))

              if (isLargeOutputAgent) {
                const largeOutput = Array.from(
                  { length: 50 },
                  (_, i) =>
                    `Line ${i + 1}: This is a substantial test line with significant content to generate large output for performance testing`
                ).join('\n')

                setTimeout(() => {
                  callback(
                    Buffer.from(
                      `${JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{ type: 'text', text: largeOutput }],
                        },
                      })}\n`
                    )
                  )
                }, 10)
              } else {
                setTimeout(() => {
                  callback(
                    Buffer.from(
                      `${JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{ type: 'text', text: 'Mock performance execution result' }],
                        },
                      })}\n`
                    )
                  )
                }, 10)
              }
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 50) // Success exit code
          } else if (event === 'error') {
          } else if (event === 'exit') {
            setTimeout(() => callback(), 50)
          }
        }),
        kill: vi.fn(),
      }
      return mockChildProcess
    })

    testAgentsDir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-execution-perf-test-'))

    await fs.writeFile(
      path.join(testAgentsDir, 'quick-agent.md'),
      `# Quick Agent\n\nFast executing test agent.\n\nUsage: echo "Quick execution"`
    )

    await fs.writeFile(
      path.join(testAgentsDir, 'medium-agent.md'),
      `# Medium Agent\n\nMedium speed agent.\n\nUsage: sleep 0.1 && echo "Medium execution"`
    )

    await fs.writeFile(
      path.join(testAgentsDir, 'large-output-agent.md'),
      `# Large Output Agent\n\nAgent that produces large output.\n\nUsage: for i in {1..1000}; do echo "Line $i: This is a test line with substantial content to generate large output"; done`
    )

    process.env.SERVER_NAME = 'execution-performance-test'
    process.env.AGENTS_DIR = testAgentsDir
    process.env.AGENT_TYPE = 'cursor'

    config = new ServerConfig()

    server = new McpServer(config)
    agentManager = new AgentManager(config)
    const executionConfig = createExecutionConfig('cursor')
    agentExecutor = new AgentExecutor(executionConfig)

    await server.start()
  })

  afterAll(async () => {
    await server.close()
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  test('should complete five concurrent executions successfully', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        agentExecutor.executeAgent({
          agent: 'quick-agent',
          prompt: `Concurrent execution test ${i + 1}`,
          cwd: process.cwd(),
        })
      )
    )

    expect(results).toHaveLength(5)
    for (const result of results) {
      expect(result.exitCode).toBe(0)
    }
  })

  test('should capture a large agent output in full', async () => {
    const result = await agentExecutor.executeAgent({
      agent: 'large-output-agent',
      prompt: 'Large output test',
      cwd: process.cwd(),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  test('should return the same definition on a repeated agent lookup', async () => {
    const first = await agentManager.getAgent('medium-agent')
    const second = await agentManager.getAgent('medium-agent')

    expect(first).toBeDefined()
    expect(second?.name).toBe(first?.name)
    expect(second?.content).toBe(first?.content)
  })
})
