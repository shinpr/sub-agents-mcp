/**
 * E2E Tests for Critical User Journeys
 *
 * Validates end-to-end user workflows through the MCP server.
 * These tests focus on user experience, not technical implementation details.
 *
 * Critical User Journeys:
 * 1. Start MCP server and verify it's ready
 * 2. Discover available agents
 * 3. Execute an agent with a prompt
 * 4. Retrieve execution results
 * 5. Handle errors gracefully
 */

import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ServerConfig } from 'src/config/ServerConfig'
import { McpServer } from 'src/server/McpServer'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

// Mock child_process module for E2E testing
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Import the mocked module to get references
import { spawn as mockSpawn } from 'node:child_process'

describe('Critical User Journeys - E2E Tests', () => {
  let server: McpServer
  let config: ServerConfig
  let testAgentsDir: string

  beforeAll(async () => {
    // Setup child_process mock before creating server
    vi.clearAllMocks()

    // Setup spawn mock for E2E testing
    mockSpawn.mockImplementation((cmd: string, args: string[], options: any) => {
      const prompt = args.includes('-p') ? args[args.indexOf('-p') + 1] : ''
      const isTestAgent = prompt.includes('test-agent') || args.includes('test-agent')
      const isPerformanceAgent =
        prompt.includes('performance-agent') || args.includes('performance-agent')

      return {
        stdin: { end: vi.fn() },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              // Synchronous for test stability
              if (isTestAgent) {
                callback(Buffer.from('{"type": "result", "data": "E2E test successful"}\n'))
              } else if (isPerformanceAgent) {
                callback(Buffer.from('{"type": "result", "data": "Performance test complete"}\n'))
              } else {
                callback(Buffer.from('{"type": "result", "data": "Agent executed successfully"}\n'))
              }
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            // Synchronous for test stability
            callback(0)
          }
        }),
        kill: vi.fn(),
      } as any
    })

    // Setup temporary agents directory for testing
    testAgentsDir = path.join(tmpdir(), 'mcp-e2e-test-agents')
    await fs.mkdir(testAgentsDir, { recursive: true })

    // Create test agent definition files
    await fs.writeFile(
      path.join(testAgentsDir, 'test-agent.md'),
      `# Test Agent\n\nA simple test agent for E2E testing.\n\nUsage: echo "Hello from test agent"`
    )

    await fs.writeFile(
      path.join(testAgentsDir, 'performance-agent.md'),
      `# Performance Agent\n\nAgent for performance testing.\n\nUsage: sleep 0.1 && echo "Performance test complete"`
    )

    // Create server configuration
    // Set test environment variables
    process.env['SERVER_NAME'] = 'e2e-test-server'
    process.env['AGENTS_DIR'] = testAgentsDir

    config = new ServerConfig()

    // Initialize and start MCP server
    server = new McpServer(config)
    await server.start()
  })

  afterAll(async () => {
    // Cleanup
    if (server) {
      await server.close()
    }
    // Clean up test agents directory
    await fs.rm(testAgentsDir, { recursive: true, force: true })
  })

  test('User Journey 1: Server starts and is ready to accept requests', async () => {
    // As a user, I want to verify the MCP server has started successfully
    const tools = await server.listTools()

    expect(tools).toBeDefined()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0) // At least run_agent tool available
  })

  test('User Journey 2: Discover available agents', async () => {
    // As a user, I want to see what agents are available
    const resources = await server.listResources()

    expect(resources).toBeDefined()
    expect(Array.isArray(resources)).toBe(true)
    expect(resources.length).toBeGreaterThan(0)

    // I should be able to access the agent list
    const agentListResource = resources.find((r) => r.uri === 'agents://list')
    expect(agentListResource).toBeDefined()
    expect(agentListResource?.name).toBe('Agent List')
  })

  test('User Journey 3: Execute an agent with a prompt', async () => {
    // As a user, I want to run an agent to perform a task
    const result = await server.callTool('run_agent', {
      agent: 'test-agent',
      prompt: 'Help me with this task',
      cwd: process.cwd(),
      extra_args: ['--verbose'],
    })

    // I expect to receive a result
    expect(result).toBeDefined()
    expect(result.content).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)

    // The result should contain text output
    const textContent = result.content.find((c) => c.type === 'text')
    expect(textContent).toBeDefined()
    expect(textContent?.text).toBeTruthy()
  })

  test('User Journey 4: Retrieve execution results', async () => {
    // As a user, I want to get results from agent execution
    const result = await server.callTool('run_agent', {
      agent: 'test-agent',
      prompt: 'Analyze this code',
      cwd: process.cwd(),
    })

    // I expect to receive both human-readable content and structured metadata
    expect(result.content).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)

    // The content should include text output
    const textContent = result.content.find((c) => c.type === 'text')
    expect(textContent).toBeDefined()
    expect(textContent?.text).toBeTruthy()
  })

  test('User Journey 5: Handle errors gracefully when things go wrong', async () => {
    // As a user, when I try to use a non-existent agent
    const result1 = await server.callTool('run_agent', {
      agent: 'non-existent-agent',
      prompt: 'This should fail gracefully',
    })

    // I expect a clear error message
    expect(result1.content).toBeDefined()
    const textContent1 = result1.content.find((c) => c.type === 'text')
    expect(textContent1?.text).toMatch(/not found|Agent not found/i)

    // As a user, when I provide invalid parameters
    const result2 = await server.callTool('run_agent', {
      agent: '', // Empty agent name
      prompt: 'This should also fail',
    })

    // I expect a helpful error message
    expect(result2.content).toBeDefined()
    const textContent2 = result2.content.find((c) => c.type === 'text')
    expect(textContent2?.text).toMatch(/invalid|required/i)
  })
})
