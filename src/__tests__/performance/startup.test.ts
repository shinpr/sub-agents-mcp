import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ServerConfig } from '../../config/ServerConfig.js'
import { McpServer } from '../../server/McpServer.js'

describe('Startup Performance Tests', () => {
  let testAgentsDir: string

  beforeAll(async () => {
    testAgentsDir = path.join(tmpdir(), 'mcp-startup-test-agents')
    await fs.mkdir(testAgentsDir, { recursive: true })

    for (let i = 1; i <= 10; i++) {
      await fs.writeFile(
        path.join(testAgentsDir, `test-agent-${i}.md`),
        `# Test Agent ${i}\n\nAgent ${i} for startup performance testing.\n\nUsage: echo "Agent ${i} ready"`
      )
    }
  })

  afterAll(async () => {
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  test('server startup time meets 3-second requirement', async () => {
    const startTime = Date.now()

    const testEnv = {
      ...process.env,
      SERVER_NAME: 'startup-performance-test',
      AGENTS_DIR: testAgentsDir,
      AGENT_TYPE: 'cursor',
    }

    const serverPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../dist/index.js'
    )
    const serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testEnv,
    })

    try {
      const startupComplete = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Startup timeout exceeded 5 seconds'))
        }, 5000)

        serverProcess.stderr?.on('data', (data) => {
          const output = data.toString()
          if (
            output.includes('MCP server started') ||
            output.includes('listening') ||
            output.includes('ready')
          ) {
            const endTime = Date.now()
            clearTimeout(timeout)
            resolve(endTime)
          }
        })

        serverProcess.stdout?.on('data', (data) => {
          const stdoutData = data.toString()
          if (stdoutData.trim()) {
            console.warn('Unexpected stdout output:', stdoutData)
          }
        })

        serverProcess.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })

        serverProcess.on('exit', (code) => {
          clearTimeout(timeout)
          if (code !== 0) {
            reject(new Error(`Server exited with code ${code}`))
          }
        })
      })

      const startupTime = startupComplete - startTime

      expect(startupTime).toBeLessThan(3000) // 3 seconds max
    } finally {
      serverProcess.kill('SIGTERM')
      await new Promise((resolve) => {
        serverProcess.on('exit', resolve)
        setTimeout(() => {
          serverProcess.kill('SIGKILL')
          resolve(undefined)
        }, 1000)
      })
    }
  })

  test('server startup time with large agent directory (stress test)', async () => {
    const stressTestDir = path.join(tmpdir(), 'mcp-startup-stress-test')
    await fs.mkdir(stressTestDir, { recursive: true })

    try {
      for (let i = 1; i <= 50; i++) {
        await fs.writeFile(
          path.join(stressTestDir, `stress-agent-${i}.md`),
          `# Stress Test Agent ${i}\n\nAgent ${i} for stress testing startup performance.\n\nUsage: echo "Stress agent ${i} ready"`
        )
      }

      const startTime = Date.now()

      const testEnv = {
        ...process.env,
        SERVER_NAME: 'startup-stress-test',
        AGENTS_DIR: stressTestDir,
        AGENT_TYPE: 'cursor',
      }

      const serverPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../dist/index.js'
      )
      const serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: testEnv,
      })

      try {
        const startupComplete = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Stress test startup timeout exceeded 5 seconds'))
          }, 5000)

          serverProcess.stderr?.on('data', (data) => {
            const output = data.toString()
            if (
              output.includes('MCP server started') ||
              output.includes('listening') ||
              output.includes('ready')
            ) {
              const endTime = Date.now()
              clearTimeout(timeout)
              resolve(endTime)
            }
          })

          serverProcess.stdout?.on('data', (data) => {
            const stdoutData = data.toString()
            if (stdoutData.trim()) {
              console.warn('Unexpected stdout output:', stdoutData)
            }
          })

          serverProcess.on('error', reject)
        })

        const stressStartupTime = startupComplete - startTime

        expect(stressStartupTime).toBeLessThan(3000)
      } finally {
        serverProcess.kill('SIGTERM')
        await new Promise((resolve) => {
          serverProcess.on('exit', resolve)
          setTimeout(() => {
            serverProcess.kill('SIGKILL')
            resolve(undefined)
          }, 1000)
        })
      }
    } finally {
      await fs.rm(stressTestDir, { recursive: true, force: true })
    }
  })

  test('server startup performance with minimal configuration', async () => {
    const startTime = Date.now()

    const minimalEnv = {
      ...process.env,
      SERVER_NAME: 'minimal-startup-test',
      AGENTS_DIR: testAgentsDir, // Use basic test directory
      AGENT_TYPE: 'cursor',
    }

    process.env.SERVER_NAME = minimalEnv.SERVER_NAME
    process.env.AGENTS_DIR = minimalEnv.AGENTS_DIR
    process.env.AGENT_TYPE = minimalEnv.AGENT_TYPE
    const config = new ServerConfig()
    const server = new McpServer(config)

    try {
      await server.start()
      const startupTime = Date.now() - startTime

      expect(startupTime).toBeLessThan(1000) // 1 second for minimal setup
    } finally {
      await server.close()
    }
  })

  test('concurrent startup requests handling', async () => {
    const startTime = Date.now()

    const testEnv = {
      ...process.env,
      SERVER_NAME: 'concurrent-startup-test',
      AGENTS_DIR: testAgentsDir,
      AGENT_TYPE: 'cursor',
    }

    const originalEnv = { ...process.env }

    Object.assign(process.env, testEnv)
    const config1 = new ServerConfig()

    process.env.SERVER_NAME = 'concurrent-test-2'
    const config2 = new ServerConfig()

    process.env.SERVER_NAME = 'concurrent-test-3'
    const config3 = new ServerConfig()

    Object.assign(process.env, originalEnv)
    const configs = [config1, config2, config3]

    const servers = configs.map((config) => new McpServer(config))

    try {
      await Promise.all(servers.map((server) => server.start()))

      const concurrentStartupTime = Date.now() - startTime

      expect(concurrentStartupTime).toBeLessThan(3000)
    } finally {
      await Promise.all(servers.map((server) => server.close()))
    }
  })

  test('startup performance with environment variable loading', async () => {
    const startTime = Date.now()

    const heavyEnv = {
      ...process.env,
      SERVER_NAME: 'env-heavy-test',
      AGENTS_DIR: testAgentsDir,
      AGENT_TYPE: 'cursor',
      TEST_VAR_1: 'value1',
      TEST_VAR_2: 'value2',
      TEST_VAR_3: 'value3',
      MAX_CONCURRENT_EXECUTIONS: '5',
      MAX_OUTPUT_SIZE: '1048576',
      PROMPT_ENHANCEMENT_ENABLED: 'true',
    }

    Object.assign(process.env, heavyEnv)
    const config = new ServerConfig()
    const configLoadTime = Date.now() - startTime

    expect(configLoadTime).toBeLessThan(100) // 100ms max for config loading

    const server = new McpServer(config)
    await server.start()

    const totalStartupTime = Date.now() - startTime
    expect(totalStartupTime).toBeLessThan(3000)

    await server.close()
  })
})
