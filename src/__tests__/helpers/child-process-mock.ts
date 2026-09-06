import type { SpawnOptions } from 'node:child_process'
import type { Mock } from 'vitest'

/**
 * The subset of `ChildProcess` that AgentExecutor actually drives. Tests mock
 * `node:child_process` wholesale, so a spawn double only has to satisfy this
 * shape rather than the full Node type.
 */
export interface MockChildProcess {
  stdin: { end: Mock }
  stdout: { on: Mock }
  stderr: { on: Mock }
  on: Mock
  kill: Mock
  killed?: boolean
}

/** Signature of the `spawn` double installed by `vi.mock('node:child_process')`. */
export type SpawnMock = Mock<
  (
    command: string,
    args: string[],
    options: SpawnOptions & { env?: NodeJS.ProcessEnv }
  ) => MockChildProcess
>
