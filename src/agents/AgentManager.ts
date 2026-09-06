import fs from 'node:fs'
import path from 'node:path'
import type { ServerConfig } from '../config/ServerConfig.js'
import type { AgentDefinition } from '../types/AgentDefinition.js'
import { type Logger, Logger as LoggerClass } from '../utils/Logger.js'
import { agentNameProblem, suggestAgentName } from './AgentName.js'

/** Sorts agent definition files by name, preferring `.md` over `.txt` on ties. */
function compareAgentFiles(left: string, right: string): number {
  const leftName = left.replace(/\.(md|txt)$/, '')
  const rightName = right.replace(/\.(md|txt)$/, '')
  const nameOrder = leftName.localeCompare(rightName)
  if (nameOrder !== 0) {
    return nameOrder
  }
  if (left.endsWith('.md') && right.endsWith('.txt')) {
    return -1
  }
  if (left.endsWith('.txt') && right.endsWith('.md')) {
    return 1
  }
  return left.localeCompare(right)
}

export class AgentManager {
  private logger: Logger

  constructor(private config: ServerConfig) {
    this.logger = new LoggerClass(config.logLevel)
  }

  /** Definition files found on disk but unusable, keyed by file name. */
  private readonly skippedDefinitions = new Map<string, string>()

  /**
   * Definition files that were discovered but cannot be exposed, with the reason.
   * Surfaced to the caller so "the file is there but the agent is missing" is
   * explainable without reading the server log.
   */
  getSkippedDefinitions(): { file: string; reason: string }[] {
    return Array.from(this.skippedDefinitions, ([file, reason]) => ({ file, reason }))
  }

  async getAgent(name: string): Promise<AgentDefinition | undefined> {
    const problem = agentNameProblem(name)
    if (problem) {
      throw new Error(`Invalid agent name: ${problem}`)
    }

    const agents = await this.loadAgentsFromDirectory()
    return agents.get(name)
  }

  async listAgents(): Promise<AgentDefinition[]> {
    const agents = await this.loadAgentsFromDirectory()
    return Array.from(agents.values())
  }

  async refreshAgents(): Promise<void> {
    await this.loadAgentsFromDirectory()
  }

  /**
   * Resolves an agent file to its real path, returning undefined when the file
   * cannot be resolved. Throws when the resolved path escapes the agents directory.
   */
  private async resolveAgentFilePath(
    agentsDir: string,
    filePath: string,
    file: string
  ): Promise<string | undefined> {
    let resolvedFilePath: string
    try {
      resolvedFilePath = await fs.promises.realpath(filePath)
    } catch (error) {
      this.logger.error(
        'Failed to resolve agent definition file',
        error instanceof Error ? error : undefined,
        { filePath }
      )
      return undefined
    }

    if (!this.isWithinDirectory(agentsDir, resolvedFilePath)) {
      throw new Error(`Agent definition resolves outside the configured agents directory: ${file}`)
    }

    return resolvedFilePath
  }

  private async loadAgentsFromDirectory(): Promise<Map<string, AgentDefinition>> {
    try {
      const agentsDir = await fs.promises.realpath(path.resolve(this.config.agentsDir))
      this.logger.info('Starting agent discovery', { directory: agentsDir })

      const files = await fs.promises.readdir(agentsDir)

      const agentFiles = files
        .filter((file) => file.endsWith('.md') || file.endsWith('.txt'))
        .sort(compareAgentFiles)

      this.logger.info('Agent definition files discovered', {
        totalFiles: files.length,
        agentFiles: agentFiles.length,
        files: agentFiles,
      })

      const agents = new Map<string, AgentDefinition>()
      this.skippedDefinitions.clear()

      for (const file of agentFiles) {
        const filePath = path.join(agentsDir, file)
        const agentName = file.replace(/\.(md|txt)$/, '')

        // Applying the run_agent naming rule here is what stops a definition from
        // being listed under a name that would then be rejected on execution.
        const nameProblem = agentNameProblem(agentName)
        if (nameProblem) {
          const extension = file.slice(agentName.length)
          this.skippedDefinitions.set(file, nameProblem)
          this.logger.warn('Agent definition skipped: unusable name', {
            file,
            reason: nameProblem,
            suggestedFileName: `${suggestAgentName(agentName)}${extension}`,
          })
          continue
        }

        if (agents.has(agentName)) {
          this.logger.warn('Duplicate agent definition ignored', {
            name: agentName,
            filePath,
            selectedFilePath: agents.get(agentName)?.filePath,
          })
          continue
        }

        const resolvedFilePath = await this.resolveAgentFilePath(agentsDir, filePath, file)
        if (!resolvedFilePath) {
          continue
        }

        const agent = await this.loadAgentFromFile(resolvedFilePath, agentName)
        if (agent) {
          agents.set(agentName, agent)
          this.logger.debug('Agent definition loaded successfully', {
            name: agent.name,
            filePath: agent.filePath,
            description: agent.description,
          })
        }
      }

      this.logger.info('Agent discovery completed', {
        loadedAgents: agents.size,
        timestamp: new Date().toISOString(),
      })

      return agents
    } catch (error) {
      this.logger.error(
        'Failed to scan agents directory',
        error instanceof Error ? error : undefined,
        { directory: this.config.agentsDir }
      )
      if (error instanceof Error && error.message.startsWith('Agent definition resolves outside')) {
        throw error
      }
      throw new Error(`Failed to load agents from directory: ${this.config.agentsDir}`, {
        cause: error,
      })
    }
  }

  private async loadAgentFromFile(
    resolvedFilePath: string,
    agentName: string
  ): Promise<AgentDefinition | undefined> {
    try {
      this.logger.debug('Loading agent definition from file', { filePath: resolvedFilePath })

      const content = await fs.promises.readFile(resolvedFilePath, 'utf-8')
      const stats = await fs.promises.stat(resolvedFilePath)

      const description = this.extractDescription(content)

      const agentDefinition: AgentDefinition = {
        name: agentName,
        description,
        content,
        filePath: resolvedFilePath,
        lastModified: stats.mtime,
      }

      this.logger.debug('Agent definition parsed successfully', {
        name: agentName,
        description,
        contentLength: content.length,
        lastModified: stats.mtime?.toISOString() ?? 'unknown',
      })

      return agentDefinition
    } catch (error) {
      this.logger.error(
        'Error reading agent definition file',
        error instanceof Error ? error : undefined,
        { filePath: resolvedFilePath }
      )
      return undefined
    }
  }

  private isWithinDirectory(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate)
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    )
  }

  private extractDescription(content: string): string {
    const lines = content.split('\n').filter((line) => line.trim())

    for (const line of lines) {
      if (line.startsWith('#')) {
        return line.replace(/^#+\s*/, '').trim()
      }
    }

    if (lines.length > 0 && lines[0]) {
      return lines[0].trim()
    }

    return 'Agent definition'
  }
}
