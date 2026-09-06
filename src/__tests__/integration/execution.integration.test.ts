import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import type { MockChildProcess, SpawnMock } from '../helpers/child-process-mock.js'

const mockSpawn: SpawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

type MockListener = (...eventArgs: unknown[]) => void

function resultChunk(result: string): Buffer {
  return Buffer.from(`${JSON.stringify({ type: 'result', result })}\n`)
}

/** Picks the stdout payload the fake CLI should emit for a given prompt. */
function stdoutFor(prompt: string): Buffer | null {
  if (prompt.includes('test-agent') || prompt.includes('integration-test-agent')) {
    return resultChunk('Integration test execution success')
  }
  if (prompt.includes('nonexistent-agent')) {
    return null
  }
  return resultChunk('Default integration execution')
}

function promptFromArgs(args: readonly string[]): string {
  const promptIndex = args.indexOf('-p')
  if (promptIndex < 0 || promptIndex >= args.length - 1) {
    return ''
  }
  return args[promptIndex + 1] ?? ''
}

function createMockProcess(prompt: string): MockChildProcess {
  const isNonexistentAgent = prompt.includes('nonexistent-agent')
  const stdoutPayload = stdoutFor(prompt)

  const mockProcess = {
    stdin: { end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, callback: MockListener) => {
        if (event === 'data' && stdoutPayload) {
          callback(stdoutPayload)
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: MockListener) => {
        if (event === 'data' && isNonexistentAgent) {
          callback(Buffer.from('Agent not found'))
        }
      }),
    },
    on: vi.fn((event: string, callback: MockListener) => {
      if (event === 'close') {
        callback(isNonexistentAgent ? 1 : 0)
        return
      }
      if (event === 'error' && isNonexistentAgent) {
        callback(new Error('Integration execution failed'))
        return
      }
      if (event === 'exit') {
        callback()
      }
    }),
    kill: vi.fn(),
  }

  return mockProcess
}

describe('AgentExecutor Integration', () => {
  let executor: AgentExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    const testConfig = createExecutionConfig('cursor')
    executor = new AgentExecutor(testConfig)

    mockSpawn.mockImplementation((_cmd, args) => createMockProcess(promptFromArgs(args)))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('end-to-end execution flow', () => {
    it('should execute complete flow from params to result collection', async () => {
      const result = await executor.executeAgent({
        agent: 'integration-test-agent',
        prompt: 'Perform integration test task',
        cwd: '/tmp/integration',
      })

      expect(result).toEqual({
        stdout: expect.any(String),
        stderr: expect.any(String),
        exitCode: expect.any(Number),
        executionTime: expect.any(Number),
        hasResult: expect.any(Boolean),
        resultJson: expect.any(Object),
      })
      expect(result.exitCode).toBe(0)
      expect(result.resultJson).toMatchObject({ result: 'Integration test execution success' })
    })

    it('should pass a large prompt to the CLI without truncating it', async () => {
      const largePrompt = 'Large complex task requiring extensive output'.repeat(100)

      await executor.executeAgent({ agent: 'test-agent', prompt: largePrompt, cwd: '/tmp' })

      // cursor concatenates the system context with the prompt, so the prompt is
      // carried inside one argument rather than passed verbatim as its own.
      const args = mockSpawn.mock.calls.at(-1)?.[1] ?? []
      expect(args.some((arg) => arg.includes(largePrompt))).toBe(true)
    })

    it('should report a failing agent through the result rather than throwing', async () => {
      const result = await executor.executeAgent({
        agent: 'nonexistent-agent',
        prompt: 'This will fail',
        cwd: '/invalid/path',
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })

    it('should reject empty execution parameters', async () => {
      await expect(executor.executeAgent({ agent: '', prompt: '', cwd: '/tmp' })).rejects.toThrow(
        /agent and prompt/i
      )
    })
  })
})
