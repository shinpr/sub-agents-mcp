import { beforeAll, describe, expect, test, vi } from 'vitest'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import type { SpawnMock } from '../helpers/child-process-mock.js'

const mockSpawn: SpawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

// Renamed from a performance suite: spawn is mocked here, so wall-clock numbers
// only measured the mock. What remains are the behaviours those tests relied on.
describe('Execution behaviour under load', () => {
  let agentExecutor: AgentExecutor

  beforeAll(() => {
    vi.clearAllMocks()

    mockSpawn.mockImplementation((_cmd, args) => {
      const executionNumber = Number(args.join(' ').match(/Concurrent execution test (\d+)/)?.[1])
      // Later executions finish first, so a result routed to the wrong caller would show.
      const delay = (6 - executionNumber) * 10

      return {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              setTimeout(() => {
                callback(
                  Buffer.from(
                    `${JSON.stringify({ type: 'result', result: `Output of execution ${executionNumber}` })}\n`
                  )
                )
              }, delay)
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), delay + 20)
          }
        }),
        kill: vi.fn(),
      }
    })

    agentExecutor = new AgentExecutor(createExecutionConfig('cursor'))
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

    expect(results.map((result) => result.exitCode)).toEqual([0, 0, 0, 0, 0])
    expect(results.map((result) => result.resultJson)).toEqual([
      expect.objectContaining({ result: 'Output of execution 1' }),
      expect.objectContaining({ result: 'Output of execution 2' }),
      expect.objectContaining({ result: 'Output of execution 3' }),
      expect.objectContaining({ result: 'Output of execution 4' }),
      expect.objectContaining({ result: 'Output of execution 5' }),
    ])
  })
})
