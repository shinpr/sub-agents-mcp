import { AgentExecutor, createExecutionConfig } from 'src/execution/AgentExecutor'
import type { ExecutionParams } from 'src/types/ExecutionParams'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process module for integration testing
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}))

// Import the mocked module to get references
import { exec as mockExec, spawn as mockSpawn } from 'node:child_process'

// Mock promisify
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => {
    return (command: string, options: any) => {
      // Simulate different behaviors based on command content
      if (command.includes('integration-test-agent:') || command.includes('test-agent:')) {
        return Promise.resolve({
          stdout: `Integration test executed: ${command}`,
          stderr: '',
        })
      }
      if (command.includes('nonexistent-agent:')) {
        return Promise.reject({
          message: 'Command failed',
          stdout: '',
          stderr: 'Agent not found',
          code: 1,
        })
      }
      return Promise.resolve({
        stdout: 'Default integration output',
        stderr: '',
      })
    }
  }),
}))

describe('AgentExecutor Integration', () => {
  let executor: AgentExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    const testConfig = createExecutionConfig('echo')
    executor = new AgentExecutor(testConfig)

    // Setup spawn mock for integration tests
    mockSpawn.mockImplementation((cmd: string, args: string[], options: any) => {
      // Extract the prompt which should be the last argument after -p flag
      const promptIndex = args.indexOf('-p')
      const prompt = promptIndex >= 0 && promptIndex < args.length - 1 ? args[promptIndex + 1] : ''
      const isNonexistentAgent = prompt.includes('nonexistent-agent')
      const isTestAgent = prompt.includes('test-agent') || prompt.includes('integration-test-agent')

      const mockProcess = {
        stdin: {
          end: vi.fn(),
        },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              if (isTestAgent) {
                // Success case - simulate assistant response
                setTimeout(() => {
                  callback(
                    Buffer.from(
                      `${JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{ type: 'text', text: 'Integration test execution success' }],
                        },
                      })}\n`
                    )
                  )
                }, 10)
              } else if (isNonexistentAgent) {
                // Don't send successful data for nonexistent agents
              } else {
                // Default success
                setTimeout(() => {
                  callback(
                    Buffer.from(
                      `${JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{ type: 'text', text: 'Default integration execution' }],
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
          on: vi.fn((event, callback) => {
            if (event === 'data' && isNonexistentAgent) {
              setTimeout(() => {
                callback(Buffer.from('Agent not found'))
              }, 10)
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            const exitCode = isNonexistentAgent ? 1 : 0
            setTimeout(() => callback(exitCode), 50)
          } else if (event === 'error' && isNonexistentAgent) {
            setTimeout(() => {
              callback(new Error('Integration execution failed'))
            }, 10)
          } else if (event === 'exit') {
            setTimeout(() => callback(), 50)
          }
        }),
        kill: vi.fn(),
      }
      return mockProcess as any
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('end-to-end execution flow', () => {
    it('should execute complete flow from params enhancement to result collection', async () => {
      const originalParams: ExecutionParams = {
        agent: 'integration-test-agent',
        prompt: 'Perform integration test task',
        cwd: '/tmp/integration',
        extra_args: ['--verbose'],
      }

      // This test verifies the complete integration flow:
      // 1. Execution method is selected (always spawn)
      // 2. Agent is executed with formatted prompt
      // 3. Results are collected with performance metrics
      const result = await executor.executeAgent(originalParams)

      expect(result).toEqual({
        stdout: expect.any(String),
        stderr: expect.any(String),
        exitCode: expect.any(Number),
        executionTime: expect.any(Number),
        executionMethod: 'spawn',
        estimatedOutputSize: expect.any(Number),
      })

      // Verify execution method is always spawn
      expect(result.executionMethod).toBe('spawn')

      // Verify performance monitoring
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.estimatedOutputSize).toBeGreaterThan(0)
    })

    it('should use spawn method for all prompt sizes', async () => {
      const smallPromptParams: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Small task',
        cwd: '/tmp',
      }

      const largePromptParams: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Large complex task requiring extensive output and detailed analysis'.repeat(100),
        cwd: '/tmp',
      }

      const smallResult = await executor.executeAgent(smallPromptParams)
      const largeResult = await executor.executeAgent(largePromptParams)

      // Verify spawn is used for all cases
      expect(smallResult.executionMethod).toBe('spawn')
      expect(largeResult.executionMethod).toBe('spawn')
    })

    it('should handle execution errors', async () => {
      const params: ExecutionParams = {
        agent: 'nonexistent-agent',
        prompt: 'This will fail',
        cwd: '/invalid/path',
      }

      const result = await executor.executeAgent(params)

      // Verify error is properly captured
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()

      // Verify performance metrics are still collected for failed executions
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.executionMethod).toBe('spawn')
    })
  })

  describe('execution method selection integration', () => {
    it('should use spawn method for all prompts', async () => {
      const params: ExecutionParams = {
        agent: 'quick-helper',
        prompt: 'Quick help',
        cwd: '/tmp',
      }

      const result = await executor.executeAgent(params)

      expect(result.executionMethod).toBe('spawn')
      expect(result.estimatedOutputSize).toBeLessThan(1024 * 1024)
    })

    it('should use spawn method for large prompts with recursion prevention', async () => {
      const params: ExecutionParams = {
        agent: 'detailed-analyzer',
        prompt:
          'Provide comprehensive analysis with detailed explanations and code examples'.repeat(200),
        cwd: '/tmp',
      }

      const result = await executor.executeAgent(params)

      expect(result.executionMethod).toBe('spawn')
      expect(result.estimatedOutputSize).toBeGreaterThanOrEqual(1024 * 1024)
    })
  })

  describe('performance monitoring integration', () => {
    it('should track performance across different prompt sizes', async () => {
      const smallParams: ExecutionParams = {
        agent: 'fast-agent',
        prompt: 'Quick task',
        cwd: '/tmp',
      }

      const largeParams: ExecutionParams = {
        agent: 'thorough-agent',
        prompt: 'Detailed analysis requiring large output'.repeat(300),
        cwd: '/tmp',
      }

      const smallResult = await executor.executeAgent(smallParams)
      const largeResult = await executor.executeAgent(largeParams)

      // Both should have performance metrics
      expect(smallResult.executionTime).toBeGreaterThanOrEqual(0)
      expect(largeResult.executionTime).toBeGreaterThanOrEqual(0)

      // Both use spawn method (no exec method anymore)
      expect(smallResult.executionMethod).toBe('spawn')
      expect(largeResult.executionMethod).toBe('spawn')

      // Output size estimation should differ
      expect(smallResult.estimatedOutputSize).toBeLessThan(largeResult.estimatedOutputSize)
    })
  })

  describe('error boundary integration', () => {
    it('should handle direct execution without enhancement errors', async () => {
      const params: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Test direct execution',
        cwd: '/tmp',
      }

      // Direct execution should work without enhancement layer
      const result = await executor.executeAgent(params)

      // Should not throw and return valid result
      expect(result).toBeDefined()
      expect(result.executionMethod).toBe('spawn')
      expect(typeof result.executionTime).toBe('number')
    })

    it('should handle both enhancement and execution errors appropriately', async () => {
      const invalidParams: ExecutionParams = {
        agent: '',
        prompt: '',
        cwd: '/tmp',
      }

      // This should fail at the parameter validation level
      await expect(executor.executeAgent(invalidParams)).rejects.toThrow()
    })
  })
})
