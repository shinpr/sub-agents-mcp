import { execFile } from 'node:child_process'

const VERSION_PATTERN = /(\d+)\.\d+/
const VERSION_TIMEOUT_MS = 10_000

/** Unreadable versions count as 1.x, the behavior before 2.x support. */
export function isOpenCodeV2(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('opencode', ['--version'], { timeout: VERSION_TIMEOUT_MS }, (error, stdout) => {
      const match = error ? null : VERSION_PATTERN.exec(stdout)
      resolve(match?.[1] !== undefined && Number(match[1]) >= 2)
    })
  })
}
