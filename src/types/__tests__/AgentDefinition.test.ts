import type { AgentDefinition } from 'src/types/AgentDefinition'
import { describe, expect, it } from 'vitest'

describe('AgentDefinition', () => {
  it('should have required properties: name, description, content, filePath, lastModified', () => {
    // This test will fail until we implement the AgentDefinition interface
    const agentDefinition: AgentDefinition = {
      name: 'test-agent',
      description: 'Test agent description',
      content: 'Test content for agent',
      filePath: '/path/to/agent.md',
      lastModified: new Date('2025-01-01T00:00:00.000Z'),
    }

    expect(agentDefinition.name).toBe('test-agent')
    expect(agentDefinition.description).toBe('Test agent description')
    expect(agentDefinition.content).toBe('Test content for agent')
    expect(agentDefinition.filePath).toBe('/path/to/agent.md')
    expect(agentDefinition.lastModified).toBeInstanceOf(Date)
  })

  it('should validate required string properties are not empty', () => {
    // Test that name and description cannot be empty strings
    const agentDefinition: AgentDefinition = {
      name: 'valid-name',
      description: 'Valid description',
      content: 'Some content',
      filePath: '/valid/path.md',
      lastModified: new Date(),
    }

    expect(agentDefinition.name.length).toBeGreaterThan(0)
    expect(agentDefinition.description.length).toBeGreaterThan(0)
    expect(agentDefinition.filePath.length).toBeGreaterThan(0)
  })

  it('should have lastModified as a valid Date object', () => {
    const now = new Date()
    const agentDefinition: AgentDefinition = {
      name: 'test-agent',
      description: 'Test description',
      content: 'Test content',
      filePath: '/test/path.md',
      lastModified: now,
    }

    expect(agentDefinition.lastModified).toBeInstanceOf(Date)
    expect(agentDefinition.lastModified.getTime()).toBe(now.getTime())
  })
})
