import { AgentManager } from 'src/agents/AgentManager'
import type { ServerConfig } from 'src/config/ServerConfig'
import type { AgentDefinition } from 'src/types/AgentDefinition'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fs module
vi.mock('node:fs', () => ({
  default: {
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn(),
      stat: vi.fn(),
    },
  },
}))

// Mock path module
vi.mock('node:path', () => ({
  default: {
    resolve: vi.fn(),
    join: vi.fn(),
    basename: vi.fn(),
  },
  resolve: vi.fn(),
  join: vi.fn(),
  basename: vi.fn(),
}))

// Import mocked modules
import fs from 'node:fs'
import path from 'node:path'

// Type the mocked functions
const mockReaddir = vi.mocked(fs.promises.readdir)
const mockReadFile = vi.mocked(fs.promises.readFile)
const mockStat = vi.mocked(fs.promises.stat)
const mockResolve = vi.mocked(path.resolve)
const mockJoin = vi.mocked(path.join)
const mockBasename = vi.mocked(path.basename)

describe('AgentManager', () => {
  let agentManager: AgentManager
  let mockConfig: ServerConfig

  beforeEach(() => {
    // Clear all mock functions
    mockReaddir.mockClear()
    mockReadFile.mockClear()
    mockStat.mockClear()
    mockResolve.mockClear()
    mockJoin.mockClear()
    mockBasename.mockClear()

    // Create mock config
    mockConfig = {
      agentsDir: '/test/agents',
      enableCache: true,
      serverName: 'test-server',
      serverVersion: '1.0.0',
      cliCommand: 'test-cli',
      maxOutputSize: 1024,
      logLevel: 'info',
    } as ServerConfig

    agentManager = new AgentManager(mockConfig)
  })

  afterEach(() => {
    // Clear all mock functions
    mockReaddir.mockClear()
    mockReadFile.mockClear()
    mockStat.mockClear()
    mockResolve.mockClear()
    mockJoin.mockClear()
    mockBasename.mockClear()
  })

  describe('File Discovery', () => {
    it('should discover .md and .txt files in agents directory', async () => {
      // Arrange
      const mockFiles = ['agent1.md', 'agent2.txt', 'readme.pdf', 'config.json']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = '# Test Agent\nThis is a test agent.'

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      // Act
      const agents = await agentManager.listAgents()

      // Assert
      expect(agents).toHaveLength(2) // Only .md and .txt files
      expect(mockReaddir).toHaveBeenCalledWith('/test/agents')
      expect(agents.some((agent) => agent.name === 'agent1')).toBe(true)
      expect(agents.some((agent) => agent.name === 'agent2')).toBe(true)
    })

    it('should handle empty agents directory', async () => {
      // Arrange
      mockReaddir.mockResolvedValue([] as unknown as fs.Dirent[])
      mockResolve.mockReturnValue('/test/agents')

      // Act
      const agents = await agentManager.listAgents()

      // Assert
      expect(agents).toHaveLength(0)
      expect(mockReaddir).toHaveBeenCalledWith('/test/agents')
    })

    it('should handle directory read errors', async () => {
      // Arrange
      mockReaddir.mockRejectedValue(new Error('Directory not found'))
      mockResolve.mockReturnValue('/test/agents')

      // Act & Assert
      await expect(agentManager.listAgents()).rejects.toThrow(
        'Failed to load agents from directory: /test/agents'
      )
    })
  })

  describe('Agent Definition Parsing', () => {
    it('should parse agent definition from markdown file content', async () => {
      // Arrange
      const mockFiles = ['test-agent.md']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = '# Test Agent\nThis is a comprehensive test agent for validation.'

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/test-agent.md')
      mockBasename.mockReturnValue('test-agent.md')

      // Act
      const agent = await agentManager.getAgent('test-agent')

      // Assert
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('test-agent')
      expect(agent!.description).toBe('Test Agent')
      expect(agent!.content).toBe(mockContent)
      expect(agent!.filePath).toBe('/test/agents/test-agent.md')
      expect(agent!.lastModified).toEqual(mockStats.mtime)
    })

    it('should extract description from first heading in markdown', async () => {
      // Arrange
      const mockFiles = ['agent.md']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = `Some preamble text
# My Custom Agent
This agent does amazing things.`

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/agent.md')
      mockBasename.mockReturnValue('agent.md')

      // Act
      const agent = await agentManager.getAgent('agent')

      // Assert
      expect(agent).toBeDefined()
      expect(agent!.description).toBe('My Custom Agent')
    })

    it('should fallback to first line if no heading found', async () => {
      // Arrange
      const mockFiles = ['simple-agent.txt']
      const mockStats = { mtime: new Date('2025-01-01') }
      const mockContent = 'Simple agent for basic tasks\nWith some additional content.'

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/simple-agent.txt')
      mockBasename.mockReturnValue('simple-agent.txt')

      // Act
      const agent = await agentManager.getAgent('simple-agent')

      // Assert
      expect(agent).toBeDefined()
      expect(agent!.description).toBe('Simple agent for basic tasks')
    })

    it('should handle file read errors gracefully', async () => {
      // Arrange
      const mockFiles = ['broken-agent.md']

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockReadFile.mockRejectedValue(new Error('Permission denied'))
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/broken-agent.md')

      // Act
      const agents = await agentManager.listAgents()

      // Assert
      expect(agents).toHaveLength(0) // Should skip broken files
    })
  })

  describe('Agent Loading', () => {
    it('should load agent definitions on every request', async () => {
      // Arrange
      const mockFiles = ['cached-agent.md']
      const mockContent = '# Cached Agent\nThis agent should be loaded.'

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockReturnValue('/test/agents/cached-agent.md')
      mockBasename.mockReturnValue('cached-agent.md')

      // Act
      const firstCall = await agentManager.getAgent('cached-agent')
      const secondCall = await agentManager.getAgent('cached-agent')

      // Assert
      expect(firstCall).toBeDefined()
      expect(secondCall).toBeDefined()
      expect(firstCall).toEqual(secondCall)
      expect(mockReaddir).toHaveBeenCalledTimes(2) // Should read directory each time
    })

    it('should load all agents on every listAgents call', async () => {
      // Arrange
      const mockFiles = ['agent1.md', 'agent2.txt']
      const mockContent = '# Test Agent\nTest content.'

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockReadFile.mockResolvedValue(mockContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      // Act
      const firstList = await agentManager.listAgents()
      const secondList = await agentManager.listAgents()

      // Assert
      expect(firstList).toHaveLength(2)
      expect(secondList).toHaveLength(2)
      expect(mockReaddir).toHaveBeenCalledTimes(2) // Should read directory each time
    })
  })

  describe('Agent Refresh', () => {
    it('should reload agents when refreshAgents is called', async () => {
      // Arrange
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

      // Set up sequential mock responses
      mockReaddir
        .mockResolvedValueOnce(initialFiles as unknown as fs.Dirent[]) // Initial listAgents
        .mockResolvedValueOnce(refreshedFiles as unknown as fs.Dirent[]) // refreshAgents
        .mockResolvedValueOnce(refreshedFiles as unknown as fs.Dirent[]) // Final listAgents

      // Act - Initial load
      const initialAgents = await agentManager.listAgents()

      // Act - Refresh
      await agentManager.refreshAgents()
      const refreshedAgents = await agentManager.listAgents()

      // Assert
      expect(initialAgents).toHaveLength(1)
      expect(refreshedAgents).toHaveLength(2)
      expect(mockReaddir).toHaveBeenCalledTimes(3) // One for each operation
    })
  })

  describe('Agent Retrieval', () => {
    it('should return undefined for non-existent agent', async () => {
      // Arrange
      mockReaddir.mockResolvedValue([] as unknown as fs.Dirent[])
      mockResolve.mockReturnValue('/test/agents')

      // Act
      const agent = await agentManager.getAgent('non-existent')

      // Assert
      expect(agent).toBeUndefined()
    })

    it('should return correct agent by name', async () => {
      // Arrange
      const mockFiles = ['target-agent.md', 'other-agent.txt']
      const mockStats = { mtime: new Date('2025-01-01') }
      const targetContent = '# Target Agent\nThis is the target agent.'
      const otherContent = '# Other Agent\nThis is the other agent.'

      mockReaddir.mockResolvedValue(mockFiles as unknown as fs.Dirent[])
      mockStat.mockResolvedValue(mockStats as fs.Stats)
      mockReadFile.mockResolvedValueOnce(targetContent).mockResolvedValueOnce(otherContent)
      mockResolve.mockReturnValue('/test/agents')
      mockJoin.mockImplementation((dir, file) => `${dir}/${file}`)
      mockBasename.mockImplementation((filePath) => {
        const parts = filePath.split('/')
        return parts[parts.length - 1]
      })

      // Act
      const agent = await agentManager.getAgent('target-agent')

      // Assert
      expect(agent).toBeDefined()
      expect(agent!.name).toBe('target-agent')
      expect(agent!.description).toBe('Target Agent')
      expect(agent!.content).toBe(targetContent)
    })
  })
})
