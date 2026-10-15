import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOpenCodeV2 } from '../OpenCodeVersion.js'

type ExecFileCallback = (error: Error | null, stdout: string) => void

const mockExecFile = vi.hoisted(() =>
  vi.fn<(file: string, args: string[], options: object, callback: ExecFileCallback) => void>()
)

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}))

function replyWith(error: Error | null, stdout: string): void {
  mockExecFile.mockImplementation((_file, _args, _options, callback) => callback(error, stdout))
}

describe('isOpenCodeV2', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  it('should select v2 for a 2.x version', async () => {
    replyWith(null, 'opencode v2.0.29\n')

    await expect(isOpenCodeV2()).resolves.toBe(true)
  })

  it.each(['1.18.20\n', 'unexpected\n'])('should count %j as v1', async (stdout) => {
    replyWith(null, stdout)

    await expect(isOpenCodeV2()).resolves.toBe(false)
  })

  it('should count a failed version check as v1', async () => {
    replyWith(new Error('spawn opencode ENOENT'), '')

    await expect(isOpenCodeV2()).resolves.toBe(false)
  })
})
