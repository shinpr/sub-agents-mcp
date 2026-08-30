import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { ServerConfig } from '../../config/ServerConfig.js'
import { AgentManager } from '../AgentManager.js'

vi.mock('node:fs', () => ({
  default: {
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn(),
      stat: vi.fn(),
      realpath: vi.fn(),
    },
  },
}))

vi.mock('node:path', () => ({
  default: {
    resolve: vi.fn(),
    join: vi.fn(),
    basename: vi.fn(),
    relative: vi.fn(),
    isAbsolute: vi.fn(),
    sep: '/',
  },
  resolve: vi.fn(),
  join: vi.fn(),
  basename: vi.fn(),
  relative: vi.fn(),
  isAbsolute: vi.fn(),
  sep: '/',
}))

import fs from 'node:fs'
import path from 'node:path'

const mockReaddir = fs.promises.readdir as unknown as Mock<
  (directoryPath: fs.PathLike) => Promise<string[]>
>
const mockReadFile = vi.mocked(fs.promises.readFile)
const mockStat = vi.mocked(fs.promises.stat)
const mockRealpath = fs.promises.realpath as unknown as Mock<
  (filePath: fs.PathLike) => Promise<string>
>
const mockResolve = vi.mocked(path.resolve)
const mockJoin = vi.mocked(path.join)
const mockBasename = vi.mocked(path.basename)
const mockRelative = vi.mocked(path.relative)
const mockIsAbsolute = vi.mocked(path.isAbsolute)

describe('AgentManager', () => {
  let agentManager: AgentManager
  let mockConfig: ServerConfig

  beforeEach(() => {
    mockReaddir.mockClear()
    mockReadFile.mockClear()
    mockStat.mockClear()
    mockRealpath.mockClear()
    mockResolve.mockClear()
    mockJoin.mockClear()
    mockBasename.mockClear()
    mockRelative.mockClear()
    mockIsAbsolute.mockClear()

    mockRealpath.mockImplementation(async (filePath) => String(filePath))
    mockRelative.mockImplementation((from, to) => {
      const prefix = `${from}/`
      return to.startsWith(prefix) ? to.slice(prefix.length) : `../${to}`
    })
    mockIsAbsolute.mockImplementation((filePath) => filePath.startsWith('/'))

    mockConfig = {
      agentsDir: '/test/agents',
      serverName: 'test-server',
      serverVersion: '1.0.0',
      agentType: 'cursor',
      logLevel: 'info',
      executionTimeoutMs: 300000,
    } as ServerConfig

    agentManager = new AgentManager(mockConfig)
  })

  afterEach(() => {
    mockReaddir.mockClear()
    mockReadFile.mockClear()
    mockStat.mockClear()
    mockRealpath.mockClear()
    mockResolve.mockClear()
    mockJoin.mockClear()
    mockBasename.mockClear()
    mockRelative.mockClear()
    mockIsAbsolute.mockClear()
  })

  describe('File Discovery', () => {
    it('should discover .md and .txt files in agents directory', async () => {
      const mockFiles = ['agent1.md', 'agent2.txt', 'readme.pdf', 'config.json']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = '# Test Agent\nThis is a test agent.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(2) // Only .md and .txt files
      expect(mockReaddir).toHaveBeenCalledWith('/test/agents')
      expect(agents.some((agent) => agent.name === 'agent1')).toBe(true)
      expect(agents.some((agent) => agent.name === 'agent2')).toBe(true)
    })

    it('should handle empty agents directory', async () => {
      mockReaddir.mockResolvedValue([])
      mockResolve.mockReturnValue('/test/agents')

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(0)
      expect(mockReaddir).toHaveBeenCalledWith('/test/agents')
    })

    it('should prefer markdown when .md and .txt definitions share a name', async () => {
      mockReaddir.mockResolvedValue(['reviewer.txt', 'reviewer.md'])
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') } as fs.Stats)
      mockReadFile.mockResolvedValue('# Markdown Reviewer')
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => filePath.split('/').at(-1) || '')

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(1)
      expect(agents[0]?.filePath).toBe('/test/agents/reviewer.md')
      expect(mockReadFile).toHaveBeenCalledTimes(1)
    })

    it('should reject an agent definition symlink that resolves outside AGENTS_DIR', async () => {
      mockReaddir.mockResolvedValue(['outside.md'])
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockRealpath
        .mockResolvedValueOnce('/test/agents')
        .mockResolvedValueOnce('/outside/outside.md')
      mockRelative.mockReturnValue('../../outside/outside.md')

      await expect(agentManager.getAgent('outside')).rejects.toThrow(/resolves outside/)
      expect(mockReadFile).not.toHaveBeenCalled()
    })

    it('should preserve the discovered name for a symlink within AGENTS_DIR', async () => {
      mockReaddir.mockResolvedValue(['alias.md'])
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockRealpath
        .mockResolvedValueOnce('/test/agents')
        .mockResolvedValueOnce('/test/agents/reviewer.md')
      mockRelative.mockReturnValue('reviewer.md')
      mockReadFile.mockResolvedValue('# Reviewer')
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') } as fs.Stats)

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(1)
      expect(agents[0]).toMatchObject({
        name: 'alias',
        filePath: '/test/agents/reviewer.md',
      })
      expect(mockReadFile).toHaveBeenCalledWith('/test/agents/reviewer.md', 'utf-8')
    })

    it('should skip a broken symlink and continue loading other agents', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const missing = Object.assign(new Error('Missing symlink target'), { code: 'ENOENT' })
      mockReaddir.mockResolvedValue(['broken.md', 'healthy.md'])
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockRealpath
        .mockResolvedValueOnce('/test/agents')
        .mockRejectedValueOnce(missing)
        .mockResolvedValueOnce('/test/agents/healthy.md')
      mockRelative.mockReturnValue('healthy.md')
      mockReadFile.mockResolvedValue('# Healthy Agent')
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') } as fs.Stats)

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(1)
      expect(agents[0]?.name).toBe('healthy')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('should handle directory read errors', async () => {
      mockReaddir.mockRejectedValue(new Error('Directory not found'))
      mockResolve.mockReturnValue('/test/agents')

      await expect(agentManager.listAgents()).rejects.toThrow(
        'Failed to load agents from directory: /test/agents'
      )
    })
  })

  describe('Agent Definition Parsing', () => {
    it('should parse agent definition from markdown file content', async () => {
      const mockFiles = ['test-agent.md']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = '# Test Agent\nThis is a comprehensive test agent for validation.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/test-agent.md')
      mockBasename.mockReturnValue('test-agent.md')

      const agent = await agentManager.getAgent('test-agent')

      expect(agent).toBeDefined()
      expect(agent!.name).toBe('test-agent')
      expect(agent!.description).toBe('Test Agent')
      expect(agent!.content).toBe(mockContent)
      expect(agent!.filePath).toBe('/test/agents/test-agent.md')
      expect(agent!.lastModified).toEqual(mockStats.mtime)
    })

    it('should extract description from first heading in markdown', async () => {
      const mockFiles = ['agent.md']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = `Some preamble text
# My Custom Agent
This agent does amazing things.`

      mockReaddir.mockResolvedValue(mockFiles)
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/agent.md')
      mockBasename.mockReturnValue('agent.md')

      const agent = await agentManager.getAgent('agent')

      expect(agent).toBeDefined()
      expect(agent!.description).toBe('My Custom Agent')
    })

    it('should fallback to first line if no heading found', async () => {
      const mockFiles = ['simple-agent.txt']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = 'Simple agent for basic tasks\nWith some additional content.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/simple-agent.txt')
      mockBasename.mockReturnValue('simple-agent.txt')

      const agent = await agentManager.getAgent('simple-agent')

      expect(agent).toBeDefined()
      expect(agent!.description).toBe('Simple agent for basic tasks')
    })

    it('should handle file read errors gracefully', async () => {
      const mockFiles = ['broken-agent.md']

      mockReaddir.mockResolvedValue(mockFiles)
      mockReadFile.mockRejectedValue(new Error('Permission denied'))
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/broken-agent.md')

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(0) // Should skip broken files
    })
  })

  describe('Agent Loading', () => {
    it('should return consistent agent data across multiple requests', async () => {
      const mockFiles = ['cached-agent.md']
      const mockContent = '# Cached Agent\nThis agent should be loaded.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/cached-agent.md')
      mockBasename.mockReturnValue('cached-agent.md')

      const firstCall = await agentManager.getAgent('cached-agent')
      const secondCall = await agentManager.getAgent('cached-agent')

      expect(firstCall).toBeDefined()
      expect(secondCall).toBeDefined()
      expect(firstCall!.name).toBe(secondCall!.name)
      expect(firstCall!.content).toBe(secondCall!.content)
    })

    it('should return all agents from directory', async () => {
      const mockFiles = ['agent1.md', 'agent2.txt']
      const mockContent = '# Test Agent\nTest content.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(2)
      expect(agents.map((a) => a.name)).toContain('agent1')
      expect(agents.map((a) => a.name)).toContain('agent2')
    })
  })

  describe('Agent Refresh', () => {
    it('should detect newly added agents after refresh', async () => {
      const initialFiles = ['initial-agent.md']
      const refreshedFiles = ['initial-agent.md', 'new-agent.md']
      const mockContent = '# Test Agent\nTest content.'

      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      mockReaddir
        .mockResolvedValueOnce(initialFiles) // Initial listAgents
        .mockResolvedValueOnce(refreshedFiles) // refreshAgents
        .mockResolvedValueOnce(refreshedFiles) // Final listAgents

      const initialAgents = await agentManager.listAgents()

      await agentManager.refreshAgents()
      const refreshedAgents = await agentManager.listAgents()

      expect(initialAgents).toHaveLength(1)
      expect(initialAgents.map((a) => a.name)).toContain('initial-agent')

      expect(refreshedAgents).toHaveLength(2)
      expect(refreshedAgents.map((a) => a.name)).toContain('initial-agent')
      expect(refreshedAgents.map((a) => a.name)).toContain('new-agent')
    })
  })

  describe('Agent Retrieval', () => {
    it('should return undefined for non-existent agent', async () => {
      mockReaddir.mockResolvedValue([])
      mockResolve.mockReturnValue('/test/agents')

      const agent = await agentManager.getAgent('non-existent')

      expect(agent).toBeUndefined()
    })

    it('should return correct agent by name', async () => {
      const mockFiles = ['target-agent.md', 'other-agent.txt']
      const mockStats = { mtime: new Date('2025-01-01') }
      const targetContent = '# Target Agent\nThis is the target agent.'
      const otherContent = '# Other Agent\nThis is the other agent.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValueOnce(otherContent).mockResolvedValueOnce(targetContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      const agent = await agentManager.getAgent('target-agent')

      expect(agent).toBeDefined()
      expect(agent!.name).toBe('target-agent')
      expect(agent!.description).toBe('Target Agent')
      expect(agent!.content).toBe(targetContent)
    })
  })
})
