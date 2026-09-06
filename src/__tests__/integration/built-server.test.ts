import { spawn } from 'node:child_process'
import fs, { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * Replaces a startup-timing suite whose assertions only measured the host
 * machine. What is kept is the part in-process tests cannot cover: that the
 * published entry point boots and speaks MCP over stdio, which is where
 * packaging problems (bad import specifiers, ESM resolution) would show up.
 */
describe('built server entry point', () => {
  let testAgentsDir: string
  const serverPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../dist/index.js'
  )

  beforeAll(async () => {
    testAgentsDir = await fs.mkdtemp(path.join(tmpdir(), 'mcp-built-server-'))
    await fs.writeFile(
      path.join(testAgentsDir, 'test-agent.md'),
      '# Test Agent\nAgent used to boot the built server.\n'
    )
  })

  afterAll(async () => {
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  test('should answer an initialize request over stdio', async () => {
    // Fail loudly rather than skipping: a missing build is the problem itself.
    try {
      await access(serverPath)
    } catch (error) {
      throw new Error(`dist/index.js is missing. Run "pnpm run build" first. (${serverPath})`, {
        cause: error,
      })
    }

    const serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SERVER_NAME: 'built-server-test',
        AGENTS_DIR: testAgentsDir,
        AGENT_TYPE: 'cursor',
      },
    })

    try {
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let buffered = ''
        serverProcess.stdout?.on('data', (chunk: Buffer) => {
          buffered += chunk.toString()
          const line = buffered.split('\n').find((candidate) => candidate.trim())
          if (line) {
            try {
              resolve(JSON.parse(line))
            } catch {
              // Keep buffering: the message has not arrived in full yet.
            }
          }
        })
        serverProcess.on('error', reject)
        serverProcess.on('exit', (code) =>
          reject(new Error(`Server exited before responding (code ${code})`))
        )

        serverProcess.stdin?.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'test', version: '1' },
            },
          })}\n`
        )
      })

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          serverInfo: { name: 'built-server-test' },
          capabilities: { tools: {}, resources: {} },
        },
      })
    } finally {
      serverProcess.kill('SIGKILL')
    }
  })
})
