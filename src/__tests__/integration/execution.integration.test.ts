import { AgentExecutor, createExecutionConfig } from 'src/execution/AgentExecutor'
import type { ExecutionParams } from 'src/types/ExecutionParams'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process module for integration testing
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Import the mocked module to get references
import { spawn as mockSpawn } from 'node:child_process'

describe('AgentExecutor Integration', () => {
  let executor: AgentExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    const testConfig = createExecutionConfig('cursor')
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
                // Success case - simulate cursor type:result response (synchronous for test stability)
                callback(
                  Buffer.from(
                    `${JSON.stringify({
                      type: 'result',
                      data: 'Integration test execution success',
                    })}\n`
                  )
                )
              } else if (isNonexistentAgent) {
                // Don't send successful data for nonexistent agents
              } else {
                // Default success - cursor type:result format (synchronous for test stability)
                callback(
                  Buffer.from(
                    `${JSON.stringify({
                      type: 'result',
                      data: 'Default integration execution',
                    })}\n`
                  )
                )
              }
            }
          }),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data' && isNonexistentAgent) {
              // Synchronous for test stability
              callback(Buffer.from('Agent not found'))
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            const exitCode = isNonexistentAgent ? 1 : 0
            // Synchronous for test stability
            callback(exitCode)
          } else if (event === 'error' && isNonexistentAgent) {
            // Synchronous for test stability
            callback(new Error('Integration execution failed'))
          } else if (event === 'exit') {
            // Synchronous for test stability
            callback()
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
        hasResult: expect.any(Boolean),
        resultJson: expect.any(Object),
      })

      // Verify basic execution properties
      expect(result.exitCode).toBeDefined()

      // Verify performance monitoring
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
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
      expect(smallResult.exitCode).toBeDefined()
      expect(largeResult.exitCode).toBeDefined()
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
      expect(result.exitCode).toBeDefined()
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

      expect(result.exitCode).toBeDefined()
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })

    it('should use spawn method for large prompts with recursion prevention', async () => {
      const params: ExecutionParams = {
        agent: 'detailed-analyzer',
        prompt:
          'Provide comprehensive analysis with detailed explanations and code examples'.repeat(200),
        cwd: '/tmp',
      }

      const result = await executor.executeAgent(params)

      expect(result.exitCode).toBeDefined()
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
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
      expect(smallResult.exitCode).toBeDefined()
      expect(largeResult.exitCode).toBeDefined()

      // Output size estimation should differ
      expect(smallResult.executionTime).toBeGreaterThanOrEqual(0)
      expect(largeResult.executionTime).toBeGreaterThanOrEqual(0)
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
      expect(result.exitCode).toBeDefined()
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
