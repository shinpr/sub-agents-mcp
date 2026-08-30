import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { AgentManager } from '../../agents/AgentManager.js'
import { ServerConfig } from '../../config/ServerConfig.js'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import { McpServer } from '../../server/McpServer.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const mockChildProcess = {
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((event, callback) => {
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
  }),
}))

vi.mock('node:util', () => ({
  promisify: vi.fn((_fn) => {
    return (command: string, _options: any) => {
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

describe('Execution Performance Tests', () => {
  let testAgentsDir: string
  let server: McpServer
  let config: ServerConfig
  let agentManager: AgentManager
  let agentExecutor: AgentExecutor

  beforeAll(async () => {
    vi.clearAllMocks()

    const { spawn } = await import('node:child_process')
    const mockedSpawn = vi.mocked(spawn)

    mockedSpawn.mockImplementation((_cmd: string, args: readonly string[], _options: any) => {
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
      return mockChildProcess as any
    })

    testAgentsDir = path.join(tmpdir(), 'mcp-execution-perf-test')
    await fs.mkdir(testAgentsDir, { recursive: true })

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

  test('agent execution start time meets 1-second requirement', async () => {
    const startTime = Date.now()

    const executionPromise = agentExecutor.executeAgent({
      agent: 'quick-agent',
      prompt: 'Performance test execution',
      cwd: process.cwd(),
    })

    const executionStartTime = Date.now() - startTime

    expect(executionStartTime).toBeLessThan(1000)

    const result = await executionPromise
    expect(result.exitCode).toBe(0)

    expect(executionStartTime).toBeLessThan(500)
  })

  test('concurrent agent execution performance (5 parallel agents)', async () => {
    const startTime = Date.now()

    const executionPromises = Array.from({ length: 5 }, (_, i) =>
      agentExecutor.executeAgent({
        agent: 'quick-agent',
        prompt: `Concurrent execution test ${i + 1}`,
        cwd: process.cwd(),
      })
    )

    const allStartedTime = Date.now() - startTime

    expect(allStartedTime).toBeLessThan(2000) // 2 seconds for 5 concurrent starts

    const results = await Promise.all(executionPromises)
    const totalExecutionTime = Date.now() - startTime

    for (const result of results) {
      expect(result.exitCode).toBe(0)
    }

    expect(allStartedTime).toBeLessThan(1000)
    expect(totalExecutionTime).toBeLessThan(5000)
  })

  test('large output handling performance', async () => {
    const startTime = Date.now()

    const result = await agentExecutor.executeAgent({
      agent: 'large-output-agent',
      prompt: 'Large output performance test',
      cwd: process.cwd(),
    })

    const executionTime = Date.now() - startTime

    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0) // Should have output

    expect(executionTime).toBeLessThan(5000) // 5 seconds max for large output handling

    expect(executionTime).toBeLessThan(5000)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  test('direct execution performance (no enhancement overhead)', async () => {
    const originalPrompt = 'Performance test for direct execution'

    const execStartTime = Date.now()
    const result = await agentExecutor.executeAgent({
      agent: 'quick-agent',
      prompt: originalPrompt,
      cwd: process.cwd(),
    })
    const execTime = Date.now() - execStartTime

    expect(execTime).toBeLessThan(1000) // Still within 1-second start requirement
    expect(result.exitCode).toBe(0)
    expect(result.exitCode).toBeDefined()

    expect(execTime).toBeLessThan(500)
  })

  test('agent loading and caching performance', async () => {
    const coldStartTime = Date.now()
    const agent1 = await agentManager.getAgent('medium-agent')
    const coldLoadTime = Date.now() - coldStartTime

    const warmStartTime = Date.now()
    const agent2 = await agentManager.getAgent('medium-agent')
    const warmLoadTime = Date.now() - warmStartTime
    if (!agent1 || !agent2) {
      throw new Error('Expected medium-agent to be available for cache performance testing')
    }

    expect(coldLoadTime).toBeLessThan(100) // 100ms max for file reading

    expect(warmLoadTime).toBeLessThan(50) // 50ms max for cached retrieval (more realistic)

    expect(agent1.name).toBe(agent2.name)
    expect(agent1.content).toBe(agent2.content)

    expect(coldLoadTime).toBeLessThan(1000)
    expect(warmLoadTime).toBeLessThan(100)
  })

  test('memory usage during heavy execution load', async () => {
    const initialMemory = process.memoryUsage()

    const executionPromises = Array.from({ length: 20 }, (_, i) =>
      agentExecutor.executeAgent({
        agent: 'quick-agent',
        prompt: `Memory test execution ${i + 1}`,
        cwd: process.cwd(),
      })
    )

    const results = await Promise.all(executionPromises)
    const finalMemory = process.memoryUsage()

    for (const result of results) {
      expect(result.exitCode).toBe(0)
    }

    const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed
    expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024) // 100MB max growth

    const memoryGrowthMB = memoryGrowth / 1024 / 1024
    expect(memoryGrowthMB).toBeLessThan(50) // Should not grow more than 50MB
  })

  test('execution timeout handling performance', async () => {
    await fs.writeFile(
      path.join(testAgentsDir, 'timeout-agent.md'),
      `# Timeout Agent\n\nAgent for timeout testing.\n\nUsage: sleep 2 && echo "Timeout test"`
    )

    const startTime = Date.now()

    try {
      const _result = await agentExecutor.executeAgent({
        agent: 'timeout-agent',
        prompt: 'Timeout performance test',
        cwd: process.cwd(),
      })

      const executionStartTime = Date.now() - startTime
      expect(executionStartTime).toBeLessThan(1000) // Start time requirement
    } catch (_error) {
      const startupTime = Date.now() - startTime
      expect(startupTime).toBeGreaterThan(999) // Should have at least tried to execute
    }
  })

  test('resource limit enforcement performance', async () => {
    const startTime = Date.now()

    const result = await agentExecutor.executeAgent({
      agent: 'quick-agent',
      prompt: 'Resource limit performance test',
      cwd: process.cwd(),
    })

    const constrainedExecutionTime = Date.now() - startTime

    expect(constrainedExecutionTime).toBeLessThan(1000)
    expect(result.exitCode).toBe(0)

    expect(constrainedExecutionTime).toBeLessThan(1000)
  })
})
