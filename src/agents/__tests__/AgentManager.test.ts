import type { PathLike } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../../config/ServerConfig.js'
import { AgentManager } from '../AgentManager.js'

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn<(directoryPath: PathLike) => Promise<string[]>>(),
  readFile: vi.fn<(filePath: PathLike, encoding: string) => Promise<string>>(),
  stat: vi.fn<(filePath: PathLike) => Promise<{ mtime: Date }>>(),
  realpath: vi.fn<(filePath: PathLike) => Promise<string>>(),
}))

vi.mock('node:fs', () => ({
  default: { promises: fsMocks },
}))

vi.mock('node:path', () => ({
  default: {
    resolve: vi.fn(),
    join: vi.fn(),
    relative: vi.fn(),
    isAbsolute: vi.fn(),
    sep: '/',
  },
  resolve: vi.fn(),
  join: vi.fn(),
  relative: vi.fn(),
  isAbsolute: vi.fn(),
  sep: '/',
}))

import path from 'node:path'

const {
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  realpath: mockRealpath,
} = fsMocks
const mockResolve = vi.mocked(path.resolve)
const mockJoin = vi.mocked(path.join)
const mockRelative = vi.mocked(path.relative)
const mockIsAbsolute = vi.mocked(path.isAbsolute)

function createMockConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    agentsDir: '/test/agents',
    serverName: 'test-server',
    serverVersion: '1.0.0',
    agentType: 'cursor',
    agentPermission: 'safe-edit',
    agentModel: undefined,
    agentEffort: undefined,
    logLevel: 'info',
    executionTimeoutMs: 300000,
    sessionEnabled: false,
    sessionDir: '.mcp-sessions',
    sessionRetentionDays: 1,
    agentsSettingsPath: undefined,
    cursorApiKey: undefined,
    glmApiKey: undefined,
    kimiApiKey: undefined,
    ...overrides,
  }
}

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
    mockRelative.mockClear()
    mockIsAbsolute.mockClear()

    mockRealpath.mockImplementation(async (filePath) => String(filePath))
    mockRelative.mockImplementation((from, to) => {
      const prefix = `${from}/`
      return to.startsWith(prefix) ? to.slice(prefix.length) : `../${to}`
    })
    mockIsAbsolute.mockImplementation((filePath) => filePath.startsWith('/'))

    mockConfig = createMockConfig()

    agentManager = new AgentManager(mockConfig)
  })

  afterEach(() => {
    mockReaddir.mockClear()
    mockReadFile.mockClear()
    mockStat.mockClear()
    mockRealpath.mockClear()
    mockResolve.mockClear()
    mockJoin.mockClear()
    mockRelative.mockClear()
    mockIsAbsolute.mockClear()
  })

  describe('File Discovery', () => {
    it('should discover .md and .txt files in agents directory', async () => {
      const mockFiles = ['agent1.md', 'agent2.txt', 'readme.pdf', 'config.json']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = '# Test Agent\nThis is a test agent.'

      mockReaddir.mockResolvedValue(mockFiles)
      mockStat.mockResolvedValue(mockStats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)

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
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') })
      mockReadFile.mockResolvedValue('# Markdown Reviewer')
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)

      const agents = await agentManager.listAgents()

      expect(agents).toHaveLength(1)
      expect(agents[0]?.filePath).toBe('/test/agents/reviewer.md')
      expect(mockReadFile).toHaveBeenCalledTimes(1)
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
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') })

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
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') })

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
      mockStat.mockResolvedValue(mockStats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/test-agent.md')

      const agent = await agentManager.getAgent('test-agent')

      expect(agent?.name).toBe('test-agent')
      expect(agent?.description).toBe('Test Agent')
      expect(agent?.content).toBe(mockContent)
      expect(agent?.filePath).toBe('/test/agents/test-agent.md')
      expect(agent?.lastModified).toEqual(mockStats.mtime)
    })

    it.each([
      {
        source: 'the first heading',
        fileName: 'agent.md',
        agentName: 'agent',
        content: 'Some preamble text\n# My Custom Agent\nThis agent does amazing things.',
        expectedDescription: 'My Custom Agent',
      },
      {
        source: 'the first line when no heading exists',
        fileName: 'simple-agent.txt',
        agentName: 'simple-agent',
        content: 'Simple agent for basic tasks\nWith some additional content.',
        expectedDescription: 'Simple agent for basic tasks',
      },
    ])(
      'should take the description from $source',
      async ({ fileName, agentName, content, expectedDescription }) => {
        mockReaddir.mockResolvedValue([fileName])
        mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') })
        mockReadFile.mockResolvedValue(content)
        mockResolve.mockReturnValue('/test/agents')
        mockJoin.mockReturnValue(`/test/agents/${fileName}`)

        const agent = await agentManager.getAgent(agentName)

        expect(agent?.description).toBe(expectedDescription)
      }
    )

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
      mockStat.mockResolvedValue(mockStats)
      mockReadFile.mockResolvedValueOnce(otherContent).mockResolvedValueOnce(targetContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)

      const agent = await agentManager.getAgent('target-agent')

      expect(agent?.name).toBe('target-agent')
      expect(agent?.description).toBe('Target Agent')
      expect(agent?.content).toBe(targetContent)
    })
  })

  describe('unusable definition names', () => {
    it('should skip files whose name cannot be used as an agent name', async () => {
      mockReaddir.mockResolvedValue(['レビュー担当.md', 'review.v2.md', 'valid-agent.md'])
      mockStat.mockResolvedValue({ mtime: new Date('2025-01-01') })
      mockReadFile.mockResolvedValue('# Valid Agent\nUsable.')
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)

      const agents = await agentManager.listAgents()

      // Only names that run_agent would also accept are exposed.
      expect(agents.map((agent) => agent.name)).toEqual(['valid-agent'])

      const skipped = agentManager.getSkippedDefinitions()
      expect(skipped.map((entry) => entry.file).sort()).toEqual(['review.v2.md', 'レビュー担当.md'])
      for (const entry of skipped) {
        expect(entry.reason).toMatch(/letters, digits, hyphens and underscores/)
      }
    })
  })
})
