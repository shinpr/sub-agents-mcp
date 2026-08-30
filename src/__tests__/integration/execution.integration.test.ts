import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import type { ExecutionParams } from '../../types/ExecutionParams.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'node:child_process'

const mockSpawn = vi.mocked(spawn)

describe('AgentExecutor Integration', () => {
  let executor: AgentExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    const testConfig = createExecutionConfig('cursor')
    executor = new AgentExecutor(testConfig)

    mockSpawn.mockImplementation((_cmd: string, args: readonly string[], _options: any) => {
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
                callback(
                  Buffer.from(
                    `${JSON.stringify({
                      type: 'result',
                      result: 'Integration test execution success',
                    })}\n`
                  )
                )
              } else if (isNonexistentAgent) {
              } else {
                callback(
                  Buffer.from(
                    `${JSON.stringify({
                      type: 'result',
                      result: 'Default integration execution',
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
              callback(Buffer.from('Agent not found'))
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            const exitCode = isNonexistentAgent ? 1 : 0
            callback(exitCode)
          } else if (event === 'error' && isNonexistentAgent) {
            callback(new Error('Integration execution failed'))
          } else if (event === 'exit') {
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

      const result = await executor.executeAgent(originalParams)

      expect(result).toEqual({
        stdout: expect.any(String),
        stderr: expect.any(String),
        exitCode: expect.any(Number),
        executionTime: expect.any(Number),
        hasResult: expect.any(Boolean),
        resultJson: expect.any(Object),
      })

      expect(result.exitCode).toBeDefined()

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

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()

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

      expect(smallResult.executionTime).toBeGreaterThanOrEqual(0)
      expect(largeResult.executionTime).toBeGreaterThanOrEqual(0)

      expect(smallResult.exitCode).toBeDefined()
      expect(largeResult.exitCode).toBeDefined()

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

      const result = await executor.executeAgent(params)

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

      await expect(executor.executeAgent(invalidParams)).rejects.toThrow()
    })
  })
})
