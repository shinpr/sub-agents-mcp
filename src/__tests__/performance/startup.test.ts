/**
 * Startup Performance Tests
 *
 * Validates that the MCP server meets startup time requirements
 * as specified in the Design Doc (≤3 seconds).
 */

import { ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ServerConfig } from 'src/config/ServerConfig'
import { McpServer } from 'src/server/McpServer'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

describe('Startup Performance Tests', () => {
  let testAgentsDir: string

  beforeAll(async () => {
    // Setup test environment
    testAgentsDir = path.join(tmpdir(), 'mcp-startup-test-agents')
    await fs.mkdir(testAgentsDir, { recursive: true })

    // Create several test agent files to simulate realistic load
    for (let i = 1; i <= 10; i++) {
      await fs.writeFile(
        path.join(testAgentsDir, `test-agent-${i}.md`),
        `# Test Agent ${i}\n\nAgent ${i} for startup performance testing.\n\nUsage: echo "Agent ${i} ready"`
      )
    }
  })

  afterAll(async () => {
    // Cleanup test agents directory
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  test('server startup time meets 3-second requirement', async () => {
    const startTime = Date.now()

    // Set test environment variables
    const testEnv = {
      ...process.env,
      SERVER_NAME: 'startup-performance-test',
      AGENTS_DIR: testAgentsDir,
      CLI_COMMAND: 'echo',
    }

    // Start server process
    const serverPath = path.join(__dirname, '../../../dist/index.js')
    const serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testEnv,
    })

    try {
      // Wait for server to be ready
      const startupComplete = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Startup timeout exceeded 5 seconds'))
        }, 5000)

        serverProcess.stdout?.on('data', (data) => {
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

        serverProcess.stderr?.on('data', (data) => {
          // Capture stderr for debugging failed tests
          const stderrOutput = data.toString()
          if (stderrOutput.includes('error') || stderrOutput.includes('Error')) {
            clearTimeout(timeout)
            reject(new Error(`Server startup error: ${stderrOutput}`))
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

      // Verify startup time requirement
      expect(startupTime).toBeLessThan(3000) // 3 seconds max

      // Performance metric captured in test assertion above
      // expect(startupTime).toBeLessThan(3000)
    } finally {
      // Clean up server process
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
    // Create larger test directory for stress testing
    const stressTestDir = path.join(tmpdir(), 'mcp-startup-stress-test')
    await fs.mkdir(stressTestDir, { recursive: true })

    try {
      // Create 50 agent files to test scalability
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
        CLI_COMMAND: 'echo',
      }

      const serverPath = path.join(__dirname, '../../../dist/index.js')
      const serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: testEnv,
      })

      try {
        const startupComplete = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Stress test startup timeout exceeded 5 seconds'))
          }, 5000)

          serverProcess.stdout?.on('data', (data) => {
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

          serverProcess.stderr?.on('data', (data) => {
            // Capture stderr for debugging
            const stderrOutput = data.toString()
            if (stderrOutput.includes('error') || stderrOutput.includes('Error')) {
              clearTimeout(timeout)
              reject(new Error(`Stress test error: ${stderrOutput}`))
            }
          })

          serverProcess.on('error', reject)
        })

        const stressStartupTime = startupComplete - startTime

        // Even with 50 agents, should still meet startup requirement
        expect(stressStartupTime).toBeLessThan(3000)

        // Performance metric already verified in assertion above
        // expect(stressStartupTime).toBeLessThan(3000)
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
      // Cleanup stress test directory
      await fs.rm(stressTestDir, { recursive: true, force: true })
    }
  })

  test('server startup performance with minimal configuration', async () => {
    // Test minimal configuration startup performance
    const startTime = Date.now()

    const minimalEnv = {
      ...process.env,
      SERVER_NAME: 'minimal-startup-test',
      AGENTS_DIR: testAgentsDir, // Use basic test directory
      CLI_COMMAND: 'echo',
    }

    const config = await ServerConfig.fromEnvironment(minimalEnv)
    const server = new McpServer(config)

    try {
      await server.start()
      const startupTime = Date.now() - startTime

      // Should start very quickly with minimal config
      expect(startupTime).toBeLessThan(1000) // 1 second for minimal setup

      // Performance metric already verified in assertion above
      // expect(startupTime).toBeLessThan(1000)
    } finally {
      await server.close()
    }
  })

  test('concurrent startup requests handling', async () => {
    // Test that server can handle multiple simultaneous startup requests
    const startTime = Date.now()

    const testEnv = {
      ...process.env,
      SERVER_NAME: 'concurrent-startup-test',
      AGENTS_DIR: testAgentsDir,
      CLI_COMMAND: 'echo',
    }

    // Start multiple server configurations simultaneously
    const configs = await Promise.all([
      ServerConfig.fromEnvironment(testEnv),
      ServerConfig.fromEnvironment({ ...testEnv, SERVER_NAME: 'concurrent-test-2' }),
      ServerConfig.fromEnvironment({ ...testEnv, SERVER_NAME: 'concurrent-test-3' }),
    ])

    const servers = configs.map((config) => new McpServer(config))

    try {
      // Start all servers concurrently
      await Promise.all(servers.map((server) => server.start()))

      const concurrentStartupTime = Date.now() - startTime

      // Even with concurrent initialization, should meet startup requirements
      expect(concurrentStartupTime).toBeLessThan(3000)

      // Performance metric already verified in assertion above
      // expect(concurrentStartupTime).toBeLessThan(3000)
    } finally {
      // Clean up all servers
      await Promise.all(servers.map((server) => server.close()))
    }
  })

  test('startup performance with environment variable loading', async () => {
    // Test that environment variable processing doesn't significantly impact startup
    const startTime = Date.now()

    // Set many environment variables to test processing overhead
    const heavyEnv = {
      ...process.env,
      SERVER_NAME: 'env-heavy-test',
      AGENTS_DIR: testAgentsDir,
      CLI_COMMAND: 'echo',
      // Add extra variables to test processing
      TEST_VAR_1: 'value1',
      TEST_VAR_2: 'value2',
      TEST_VAR_3: 'value3',
      MAX_CONCURRENT_EXECUTIONS: '5',
      MAX_OUTPUT_SIZE: '1048576',
      PROMPT_ENHANCEMENT_ENABLED: 'true',
    }

    const config = await ServerConfig.fromEnvironment(heavyEnv)
    const configLoadTime = Date.now() - startTime

    // Configuration loading should be very fast
    expect(configLoadTime).toBeLessThan(100) // 100ms max for config loading

    const server = new McpServer(config)
    await server.start()

    const totalStartupTime = Date.now() - startTime
    expect(totalStartupTime).toBeLessThan(3000)

    // Performance metric already verified in assertion above
    // expect(totalStartupTime).toBeLessThan(3000)

    await server.close()
  })
})
