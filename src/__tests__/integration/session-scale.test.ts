import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionManager } from '../../session/SessionManager.js'
import type { SessionConfig, SessionEntry } from '../../types/SessionData.js'

/**
 * Previously a wall-clock performance suite. The thresholds measured the host
 * machine rather than the code and were already loosened once (a test named
 * "less than 100ms" asserted 500ms), so they were dropped. What remains are the
 * behaviours those tests depended on: many entries and many expired files.
 */
describe('Session Management - Scale', () => {
  let testSessionDir: string
  let sessionConfig: SessionConfig

  const response = (suffix: string): SessionEntry['response'] => ({
    stdout: `Output ${suffix}`,
    stderr: '',
    exitCode: 0,
    executionTime: 100,
  })

  beforeEach(async () => {
    testSessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-scale-'))
    sessionConfig = {
      enabled: true,
      sessionDir: testSessionDir,
      retentionDays: 7,
    }
  })

  afterEach(async () => {
    await fs.rm(testSessionDir, { recursive: true, force: true }).catch(() => {})
  })

  it('should accumulate every appended entry in order', async () => {
    const manager = new SessionManager(sessionConfig)
    const sessionId = 'many-entries'

    for (let i = 0; i < 10; i++) {
      await manager.saveSession(
        sessionId,
        { agent: 'rule-advisor', prompt: `Prompt ${i}` },
        response(String(i))
      )
    }

    const loaded = await manager.loadSession(sessionId, 'rule-advisor')

    expect(loaded?.history).toHaveLength(10)
    expect(loaded?.history.map((entry) => entry.request.prompt)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Prompt ${i}`)
    )
  })

  it('should remove every expired file in one cleanup pass', async () => {
    const manager = new SessionManager(sessionConfig)
    const eightDaysAgo = new Date()
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)

    for (let i = 0; i < 50; i++) {
      const filePath = path.join(testSessionDir, `old-session-${i}_rule-advisor.json`)
      await fs.writeFile(filePath, JSON.stringify({ test: 'data' }), 'utf-8')
      await fs.utimes(filePath, eightDaysAgo, eightDaysAgo)
    }

    await manager.cleanupOldSessions()

    expect(await fs.readdir(testSessionDir)).toHaveLength(0)
  })
})
