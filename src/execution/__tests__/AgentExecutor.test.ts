import {
  AgentExecutor,
  DEFAULT_EXECUTION_THRESHOLDS,
  createExecutionConfig,
} from 'src/execution/AgentExecutor'
import type { ExecutionParams } from 'src/types/ExecutionParams'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process module
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}))

// Import the mocked module to get references
import { exec as mockExec, spawn as mockSpawn } from 'node:child_process'

// Mock promisify
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => {
    // Return a promisified version of exec
    return (command: string, options: any) => {
      // Simulate different behaviors based on command content
      if (command.includes('test-agent:')) {
        return Promise.resolve({
          stdout: `Executed: ${command}`,
          stderr: '',
        })
      }
      if (command.includes('nonexistent-agent:') || command.includes('bad-agent:')) {
        return Promise.reject({
          message: 'Command failed',
          stdout: '',
          stderr: 'Agent not found',
          code: 1,
        })
      }
      if (command.includes('slow-agent:')) {
        const error = new Error('Execution timeout exceeded')
        Object.assign(error, {
          code: 'ETIMEOUT',
          stdout: '',
          stderr: 'Execution timeout exceeded',
        })
        return Promise.reject(error)
      }
      return Promise.resolve({
        stdout: 'Default output',
        stderr: '',
      })
    }
  }),
}))

describe('AgentExecutor', () => {
  let executor: AgentExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    const testConfig = createExecutionConfig('echo')
    executor = new AgentExecutor(testConfig)

    // Setup spawn mock
    mockSpawn.mockImplementation((cmd: string, args: string[], options: any) => {
      // Extract the prompt which should be the last argument after -p flag
      const promptIndex = args.indexOf('-p')
      const prompt = promptIndex >= 0 && promptIndex < args.length - 1 ? args[promptIndex + 1] : ''
      // Check if the prompt contains agent information formatted as "agent: prompt text"
      const isTestAgent = prompt.includes('test-agent')
      const isBadAgent = prompt.includes('bad-agent') || prompt.includes('nonexistent-agent')
      const isSlowAgent = prompt.includes('slow-agent')

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
                          content: [{ type: 'text', text: 'Test execution success' }],
                        },
                      })}\n`
                    )
                  )
                }, 10)
              } else if (isBadAgent || isSlowAgent) {
                // Don't send successful data for bad agents or slow agents
              } else {
                // Default success
                setTimeout(() => {
                  callback(
                    Buffer.from(
                      `${JSON.stringify({
                        type: 'assistant',
                        message: {
                          content: [{ type: 'text', text: 'Default execution' }],
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
            if (event === 'data') {
              if (isBadAgent) {
                setTimeout(() => {
                  callback(Buffer.from('Agent not found or execution failed'))
                }, 10)
              } else if (isSlowAgent) {
                // Don't send stderr for slow agent, let it timeout
              }
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            if (isSlowAgent) {
              // For slow agent, don't call close callback to simulate timeout
              // The timeout handler in AgentExecutor will kill the process
            } else {
              // Simulate process close with appropriate exit code
              const exitCode = isBadAgent ? 1 : 0
              setTimeout(() => callback(exitCode), 50)
            }
          } else if (event === 'error' && isBadAgent) {
            // Trigger error for invalid scenarios
            setTimeout(() => {
              callback(new Error('Spawn execution failed'))
            }, 10)
          } else if (event === 'exit') {
            if (!isSlowAgent) {
              setTimeout(() => callback(), 50)
            }
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

  describe('constructor', () => {
    it('should create instance with config', () => {
      const config = createExecutionConfig('echo')
      const defaultExecutor = new AgentExecutor(config)
      expect(defaultExecutor).toBeInstanceOf(AgentExecutor)
    })

    it('should create instance with custom config', () => {
      const customConfig = createExecutionConfig('echo', {
        outputSizeThreshold: 512 * 1024,
        executionTimeout: 15000,
      })
      const customExecutor = new AgentExecutor(customConfig)
      expect(customExecutor).toBeInstanceOf(AgentExecutor)
    })
  })

  describe('selectExecutionMethod', () => {
    it('should always return spawn for proper TTY handling', () => {
      const params: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Simple help request',
        cwd: '/tmp',
      }

      const method = executor.selectExecutionMethod(params)
      expect(method).toBe('spawn')
    })

    it('should return spawn regardless of output size', () => {
      const smallParams: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Small task',
        cwd: '/tmp',
      }

      const largeParams: ExecutionParams = {
        agent: 'test-agent',
        prompt:
          'Generate a very large response with detailed code examples and documentation'.repeat(
            100
          ),
        cwd: '/tmp',
      }

      expect(executor.selectExecutionMethod(smallParams)).toBe('spawn')
      expect(executor.selectExecutionMethod(largeParams)).toBe('spawn')
    })
  })

  describe('executeAgent with spawn method', () => {
    it('should execute agent successfully with spawn', async () => {
      const params: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Help me',
        cwd: '/tmp',
      }

      const result = await executor.executeAgent(params)

      expect(result).toEqual({
        stdout: expect.any(String),
        stderr: expect.any(String),
        exitCode: expect.any(Number),
        executionTime: expect.any(Number),
        executionMethod: 'spawn',
        estimatedOutputSize: expect.any(Number),
      })
      expect(result.exitCode).toBe(0)
      expect(result.executionTime).toBeGreaterThan(0)
    })

    it('should handle exec execution failure', async () => {
      const params: ExecutionParams = {
        agent: 'nonexistent-agent',
        prompt: 'This should fail',
        cwd: '/tmp',
      }

      const result = await executor.executeAgent(params)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
      expect(result.executionMethod).toBe('spawn')
    })

    it('should execute agent successfully with spawn for large output', async () => {
      const params: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Generate detailed documentation'.repeat(200),
        cwd: '/tmp',
      }

      const result = await executor.executeAgent(params)

      expect(result).toEqual({
        stdout: expect.any(String),
        stderr: expect.any(String),
        exitCode: expect.any(Number),
        executionTime: expect.any(Number),
        executionMethod: 'spawn',
        estimatedOutputSize: expect.any(Number),
      })
      expect(result.estimatedOutputSize).toBeGreaterThan(
        DEFAULT_EXECUTION_THRESHOLDS.outputSizeThreshold
      )
    })

    it('should handle spawn execution failure', async () => {
      const params: ExecutionParams = {
        agent: 'bad-agent',
        prompt: 'This should fail with spawn'.repeat(200),
        cwd: '/invalid-directory',
      }

      const result = await executor.executeAgent(params)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
      expect(result.executionMethod).toBe('spawn')
    })
  })

  describe('execution performance monitoring', () => {
    it('should measure execution time accurately', async () => {
      const params: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Quick task',
        cwd: '/tmp',
      }

      const startTime = Date.now()
      const result = await executor.executeAgent(params)
      const endTime = Date.now()

      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.executionTime).toBeLessThanOrEqual(endTime - startTime + 100) // Allow 100ms tolerance
    })

    it('should include execution method in result', async () => {
      const smallParams: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Small task',
        cwd: '/tmp',
      }

      const largeParams: ExecutionParams = {
        agent: 'test-agent',
        prompt: 'Large task'.repeat(1000),
        cwd: '/tmp',
      }

      const smallResult = await executor.executeAgent(smallParams)
      const largeResult = await executor.executeAgent(largeParams)

      expect(smallResult.executionMethod).toBe('spawn')
      expect(largeResult.executionMethod).toBe('spawn')
    })
  })

  describe('error handling', () => {
    it('should handle invalid execution parameters', async () => {
      const invalidParams = {
        agent: '',
        prompt: '',
        cwd: '/tmp',
      } as ExecutionParams

      await expect(executor.executeAgent(invalidParams)).rejects.toThrow()
    })

    it('should handle timeout scenarios', async () => {
      const timeoutConfig = createExecutionConfig('echo', {
        outputSizeThreshold: 1024 * 1024,
        executionTimeout: 100,
      })
      const timeoutExecutor = new AgentExecutor(timeoutConfig)

      const params: ExecutionParams = {
        agent: 'slow-agent',
        prompt: 'This takes a long time',
        cwd: '/tmp',
      }

      const result = await timeoutExecutor.executeAgent(params)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('timeout')
    })
  })
})
