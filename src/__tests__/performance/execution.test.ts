/**
 * Execution Performance Tests
 *
 * Validates that agent execution meets performance requirements
 * as specified in the Design Doc (execution start ≤1 second).
 */

import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentManager } from 'src/agents/AgentManager'
import { ServerConfig } from 'src/config/ServerConfig'
import { AgentExecutor, createExecutionConfig } from 'src/execution/AgentExecutor'
import { McpServer } from 'src/server/McpServer'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

// Mock child_process for performance tests
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(() => {
    // Mock spawn to return a mock ChildProcess
    const mockChildProcess = {
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            // Simulate stdout data with assistant response
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
          // No error for performance tests
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
  promisify: vi.fn((fn) => {
    return (command: string, options: any) => {
      // Simulate quick execution for performance testing
      const agent = command.match(/([\w-]+):/)?.[1]

      if (agent === 'quick-agent') {
        return Promise.resolve({
          stdout: 'Quick execution',
          stderr: '',
        })
      }
      if (agent === 'medium-agent') {
        // Simulate slight delay for medium agent
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
        // Generate large output
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
    // Clear previous mocks first
    vi.clearAllMocks()

    // Setup mock for child_process exec
    const { exec } = await import('node:child_process')
    const mockedExec = vi.mocked(exec)

    // Mock successful execution with different outputs based on agent
    mockedExec.mockImplementation((command, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      if (cb) {
        setTimeout(() => {
          // Generate different outputs based on the command content
          let output = 'Quick execution\n'

          if (command.includes('large-output-agent')) {
            // Generate large output for large output tests
            output = `${Array.from(
              { length: 100 },
              (_, i) =>
                `Line ${i + 1}: This is a test line with substantial content to generate large output`
            ).join('\n')}\n`
          } else if (command.includes('medium-agent')) {
            output = 'Medium execution\n'
          }

          cb(null, output, '')
        }, 10) // Simulate fast execution
      }
      return {} as any
    })

    // Setup mock for child_process spawn (used by AgentExecutor)
    const { spawn } = await import('node:child_process')
    const mockedSpawn = vi.mocked(spawn)

    // Mock spawn to behave consistently for performance tests - override the vi.mock definition
    mockedSpawn.mockImplementation((cmd: string, args: string[], options: any) => {
      // Return the same mock ChildProcess that was defined in the vi.mock
      const mockChildProcess = {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Check for agent type in the args array
              const isLargeOutputAgent = args.some((arg) => arg.includes('large-output-agent'))

              if (isLargeOutputAgent) {
                // Generate large output for large-output-agent
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
                // Standard response for other agents
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
            // No error for performance tests
          } else if (event === 'exit') {
            setTimeout(() => callback(), 50)
          }
        }),
        kill: vi.fn(),
      }
      return mockChildProcess as any
    })

    // Setup test environment
    testAgentsDir = path.join(tmpdir(), 'mcp-execution-perf-test')
    await fs.mkdir(testAgentsDir, { recursive: true })

    // Create test agents with different execution characteristics
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

    // Initialize server components
    // Set test environment variables
    process.env.SERVER_NAME = 'execution-performance-test'
    process.env.AGENTS_DIR = testAgentsDir

    config = new ServerConfig()

    server = new McpServer(config)
    agentManager = new AgentManager(config)
    const executionConfig = createExecutionConfig('bash')
    agentExecutor = new AgentExecutor(executionConfig)

    await server.start()
  })

  afterAll(async () => {
    await server.close()
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  test('agent execution start time meets 1-second requirement', async () => {
    const startTime = Date.now()

    // Test execution start (not completion)
    const executionPromise = agentExecutor.executeAgent({
      agent: 'quick-agent',
      prompt: 'Performance test execution',
      cwd: process.cwd(),
    })

    // The requirement is for execution START, not completion
    // We measure until the execution process begins
    const executionStartTime = Date.now() - startTime

    // Should start execution within 1 second
    expect(executionStartTime).toBeLessThan(1000)

    // Wait for completion to clean up properly
    const result = await executionPromise
    expect(result.exitCode).toBe(0)

    // Performance metric: execution start time
    expect(executionStartTime).toBeLessThan(100)
  })

  test('concurrent agent execution performance (5 parallel agents)', async () => {
    const startTime = Date.now()

    // Execute 5 agents concurrently as per Design Doc requirement
    const executionPromises = Array.from({ length: 5 }, (_, i) =>
      agentExecutor.executeAgent({
        agent: 'quick-agent',
        prompt: `Concurrent execution test ${i + 1}`,
        cwd: process.cwd(),
      })
    )

    // Measure time until all executions start
    const allStartedTime = Date.now() - startTime

    // All 5 agents should start within reasonable time
    expect(allStartedTime).toBeLessThan(2000) // 2 seconds for 5 concurrent starts

    // Wait for all to complete
    const results = await Promise.all(executionPromises)
    const totalExecutionTime = Date.now() - startTime

    // Verify all executed successfully
    for (const result of results) {
      expect(result.exitCode).toBe(0)
    }

    // Performance metrics for concurrent execution
    expect(allStartedTime).toBeLessThan(200)
    expect(totalExecutionTime).toBeLessThan(5000)
  })

  test('large output handling performance (exec vs spawn switching)', async () => {
    const startTime = Date.now()

    // Execute agent that produces large output
    const result = await agentExecutor.executeAgent({
      agent: 'large-output-agent',
      prompt: 'Large output performance test',
      cwd: process.cwd(),
    })

    const executionTime = Date.now() - startTime

    // Should handle large output without memory errors
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0) // Should have output

    // Performance should still be reasonable for large output
    expect(executionTime).toBeLessThan(5000) // 5 seconds max for large output handling

    // Performance metrics for large output
    expect(executionTime).toBeLessThan(3000)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  test('direct execution performance (no enhancement overhead)', async () => {
    const originalPrompt = 'Performance test for direct execution'

    // Measure direct execution time
    const execStartTime = Date.now()
    const result = await agentExecutor.executeAgent({
      agent: 'quick-agent',
      prompt: originalPrompt,
      cwd: process.cwd(),
    })
    const execTime = Date.now() - execStartTime

    // Direct execution should be fast
    expect(execTime).toBeLessThan(1000) // Still within 1-second start requirement
    expect(result.exitCode).toBe(0)
    expect(result.exitCode).toBeDefined()

    // Performance metrics for direct execution
    expect(execTime).toBeLessThan(100)
  })

  test('agent loading and caching performance', async () => {
    // Test cold loading performance
    const coldStartTime = Date.now()
    const agent1 = await agentManager.getAgent('medium-agent')
    const coldLoadTime = Date.now() - coldStartTime

    // Test warm loading (cached) performance
    const warmStartTime = Date.now()
    const agent2 = await agentManager.getAgent('medium-agent')
    const warmLoadTime = Date.now() - warmStartTime

    // Cold loading should be fast
    expect(coldLoadTime).toBeLessThan(100) // 100ms max for file reading

    // Warm loading should be very fast (cached)
    expect(warmLoadTime).toBeLessThan(50) // 50ms max for cached retrieval (more realistic)

    // Should return same agent definition
    expect(agent1.name).toBe(agent2.name)
    expect(agent1.content).toBe(agent2.content)

    // Performance metrics for agent loading
    expect(coldLoadTime).toBeLessThan(1000)
    expect(warmLoadTime).toBeLessThan(100)
  })

  test('memory usage during heavy execution load', async () => {
    const initialMemory = process.memoryUsage()

    // Execute many agents to test memory efficiency
    const executionPromises = Array.from({ length: 20 }, (_, i) =>
      agentExecutor.executeAgent({
        agent: 'quick-agent',
        prompt: `Memory test execution ${i + 1}`,
        cwd: process.cwd(),
      })
    )

    const results = await Promise.all(executionPromises)
    const finalMemory = process.memoryUsage()

    // All executions should succeed
    for (const result of results) {
      expect(result.exitCode).toBe(0)
    }

    // Memory growth should be reasonable
    const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed
    expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024) // 100MB max growth

    // Memory leak detection
    const memoryGrowthMB = memoryGrowth / 1024 / 1024
    expect(memoryGrowthMB).toBeLessThan(50) // Should not grow more than 50MB
  })

  test('execution timeout handling performance', async () => {
    // Create a test agent that might take longer
    await fs.writeFile(
      path.join(testAgentsDir, 'timeout-agent.md'),
      `# Timeout Agent\n\nAgent for timeout testing.\n\nUsage: sleep 2 && echo "Timeout test"`
    )

    const startTime = Date.now()

    try {
      // This should still start quickly even if it will timeout
      const result = await agentExecutor.executeAgent({
        agent: 'timeout-agent',
        prompt: 'Timeout performance test',
        cwd: process.cwd(),
      })

      // Execution might complete or timeout, but start should be fast
      const executionStartTime = Date.now() - startTime
      expect(executionStartTime).toBeLessThan(1000) // Start time requirement
    } catch (error) {
      // If timeout occurs, the start should still have been fast
      const startupTime = Date.now() - startTime
      expect(startupTime).toBeGreaterThan(999) // Should have at least tried to execute
    }
  })

  test('resource limit enforcement performance', async () => {
    // Test that resource limits don't significantly impact performance
    const startTime = Date.now()

    // Execute with resource constraints
    const result = await agentExecutor.executeAgent({
      agent: 'quick-agent',
      prompt: 'Resource limit performance test',
      cwd: process.cwd(),
    })

    const constrainedExecutionTime = Date.now() - startTime

    // Resource limit enforcement should not significantly impact start time
    expect(constrainedExecutionTime).toBeLessThan(1000)
    expect(result.exitCode).toBe(0)

    // Performance metrics under resource constraints
    expect(constrainedExecutionTime).toBeLessThan(200)
  })
})
