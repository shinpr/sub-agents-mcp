/**
 * AgentResources implementation for publishing agent definitions via MCP
 *
 * Provides MCP resources for agent discovery including a list of all
 * available agents and individual agent definition resources.
 */

import type { AgentManager } from 'src/agents/AgentManager'
import type { AgentDefinition } from 'src/types/AgentDefinition'
import { Logger } from 'src/utils/Logger'

/**
 * MCP resource content type for text responses
 */
interface McpResourceContent {
  [x: string]: unknown
  type: 'text'
  text: string
  uri: string
}

/**
 * MCP resource response format
 */
interface McpResourceResponse {
  [x: string]: unknown
  contents: McpResourceContent[]
}

/**
 * MCP resource definition for publication
 */
interface McpResource {
  [x: string]: unknown
  uri: string
  name: string
  description: string
  mimeType?: string
}

/**
 * AgentResources class for managing agent definition resources in MCP
 *
 * Publishes agent information as MCP resources that clients can discover
 * and read to understand available agents and their capabilities.
 */
export class AgentResources {
  private logger: Logger

  constructor(private agentManager?: AgentManager) {
    this.logger = new Logger('info')
  }

  /**
   * Get list of all published agent resources
   *
   * @returns Promise resolving to array of MCP resource definitions
   */
  async listResources(): Promise<McpResource[]> {
    const startTime = Date.now()

    this.logger.debug('Starting resource listing', {
      timestamp: new Date().toISOString(),
    })

    const resources: McpResource[] = []

    // Add agent list resource
    resources.push({
      uri: 'agents://list',
      name: 'Agent List',
      description: 'List of available Claude Code sub-agents',
      mimeType: 'text/plain',
    })

    // Add individual agent resources if agent manager is available
    if (this.agentManager) {
      try {
        const agents = await this.agentManager.listAgents()

        this.logger.debug('Agents loaded for resource listing', {
          agentCount: agents.length,
          loadTime: Date.now() - startTime,
        })

        for (const agent of agents) {
          resources.push({
            uri: `agents://${agent.name}`,
            name: `Agent: ${agent.name}`,
            description: agent.description || 'Agent definition',
            mimeType: 'text/markdown',
          })
        }
      } catch (error) {
        this.logger.error(
          'Failed to load agents for resource listing',
          error instanceof Error ? error : undefined,
          {
            loadTime: Date.now() - startTime,
          }
        )
        // If we can't load agents, just return the list resource
      }
    } else {
      this.logger.warn('Agent manager not available for resource listing')
    }

    this.logger.info('Resource listing completed', {
      resourceCount: resources.length,
      totalTime: Date.now() - startTime,
    })

    return resources
  }

  /**
   * Read content of a specific agent resource
   *
   * @param uri - Resource URI to read
   * @returns Promise resolving to resource content
   * @throws {Error} When resource URI is invalid or not found
   */
  async readResource(uri: string): Promise<McpResourceResponse> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logger.info('Resource read requested', {
      requestId,
      uri,
      timestamp: new Date().toISOString(),
    })

    try {
      let result: McpResourceResponse

      if (uri === 'agents://list') {
        result = await this.getAgentListContent()
      } else {
        // Check for individual agent resource
        const agentNameMatch = uri.match(/^agents:\/\/(.+)$/)
        if (agentNameMatch?.[1]) {
          const agentName = agentNameMatch[1]
          result = await this.getAgentContent(agentName)
        } else {
          throw new Error(`Invalid resource URI format: ${uri}`)
        }
      }

      this.logger.info('Resource read completed', {
        requestId,
        uri,
        readTime: Date.now() - startTime,
        contentLength: result.contents[0]?.text?.length || 0,
      })

      return result
    } catch (error) {
      this.logger.error('Resource read failed', error instanceof Error ? error : undefined, {
        requestId,
        uri,
        readTime: Date.now() - startTime,
      })
      throw error
    }
  }

  /**
   * Get content for the agent list resource
   *
   * @private
   * @returns Promise resolving to agent list content
   */
  private async getAgentListContent(): Promise<McpResourceResponse> {
    if (!this.agentManager) {
      return {
        contents: [
          {
            type: 'text',
            text: 'Agent manager not available. No agents can be listed.',
            uri: 'agents://list',
          },
        ],
      }
    }

    try {
      const agents = await this.agentManager.listAgents()

      if (agents.length === 0) {
        return {
          contents: [
            {
              type: 'text',
              text: 'No agents available. Check agent directory configuration.',
              uri: 'agents://list',
            },
          ],
        }
      }

      let listText = `Available Claude Code Sub-Agents (${agents.length} total):\n\n`

      for (const agent of agents) {
        listText += `## ${agent.name}\n`
        listText += `**Description:** ${agent.description}\n`
        listText += `**File:** ${agent.filePath}\n`
        listText += `**Last Modified:** ${agent.lastModified.toISOString()}\n`
        listText += `**Resource URI:** agents://${agent.name}\n\n`
      }

      return {
        contents: [
          {
            type: 'text',
            text: listText,
            uri: 'agents://list',
          },
        ],
      }
    } catch (error) {
      return {
        contents: [
          {
            type: 'text',
            text: `Error loading agent list: ${error instanceof Error ? error.message : 'Unknown error'}`,
            uri: 'agents://list',
          },
        ],
      }
    }
  }

  /**
   * Get content for a specific agent resource
   *
   * @private
   * @param agentName - Name of the agent to get content for
   * @returns Promise resolving to agent content
   */
  private async getAgentContent(agentName: string): Promise<McpResourceResponse> {
    if (!this.agentManager) {
      return {
        contents: [
          {
            type: 'text',
            text: 'Agent manager not available. Agent content cannot be retrieved.',
            uri: `agents://${agentName}`,
          },
        ],
      }
    }

    try {
      const agent = await this.agentManager.getAgent(agentName)

      if (!agent) {
        const availableAgents = await this.getAvailableAgentNames()
        let errorText = `Agent '${agentName}' not found.`

        if (availableAgents.length > 0) {
          errorText += `\n\nAvailable agents:\n${availableAgents.map((name) => `- ${name}`).join('\n')}`
        }

        return {
          contents: [
            {
              type: 'text',
              text: errorText,
              uri: `agents://${agentName}`,
            },
          ],
        }
      }

      return {
        contents: [
          {
            type: 'text',
            text: this.formatAgentContent(agent),
            uri: `agents://${agentName}`,
          },
        ],
      }
    } catch (error) {
      return {
        contents: [
          {
            type: 'text',
            text: `Error loading agent '${agentName}': ${error instanceof Error ? error.message : 'Unknown error'}`,
            uri: `agents://${agentName}`,
          },
        ],
      }
    }
  }

  /**
   * Format agent definition content for display
   *
   * @private
   * @param agent - Agent definition to format
   * @returns Formatted content string
   */
  private formatAgentContent(agent: AgentDefinition): string {
    let content = `# Agent: ${agent.name}\n\n`
    content += `**Description:** ${agent.description}\n`
    content += `**File Path:** ${agent.filePath}\n`
    content += `**Last Modified:** ${agent.lastModified.toISOString()}\n`
    content += `**Content Length:** ${agent.content.length} characters\n\n`
    content += '## Agent Definition\n\n'
    content += agent.content

    return content
  }

  /**
   * Get list of available agent names
   *
   * @private
   * @returns Promise resolving to array of agent names
   */
  private async getAvailableAgentNames(): Promise<string[]> {
    if (!this.agentManager) {
      return []
    }

    try {
      const agents = await this.agentManager.listAgents()
      return agents.map((agent) => agent.name)
    } catch (error) {
      return []
    }
  }

  /**
   * Generate unique request ID for tracking
   *
   * @private
   * @returns Unique request identifier
   */
  private generateRequestId(): string {
    return `resource_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Check if a resource URI is valid with enhanced validation
   *
   * @param uri - Resource URI to validate
   * @returns True if URI is valid
   */
  isValidResourceUri(uri: string): boolean {
    if (!uri || typeof uri !== 'string') {
      return false
    }

    if (uri === 'agents://list') {
      return true
    }

    const agentNameMatch = uri.match(/^agents:\/\/(.+)$/)
    if (!agentNameMatch || !agentNameMatch[1]) {
      return false
    }

    const agentName = agentNameMatch[1]

    // Validate agent name format
    if (agentName.length === 0 || agentName.length > 100) {
      return false
    }

    // Check for valid characters (same as RunAgentTool validation)
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      return false
    }

    return true
  }
}
