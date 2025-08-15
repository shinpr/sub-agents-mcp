/**
 * Represents an AI agent definition loaded from a markdown file.
 * This interface defines the structure for Claude Code sub-agent format files
 * that contain agent instructions and metadata.
 */
export interface AgentDefinition {
  /**
   * The unique name identifier of the agent.
   * Used as the key for agent selection and execution.
   */
  name: string

  /**
   * Human-readable description of what the agent does.
   * Provides context about the agent's purpose and capabilities.
   */
  description: string

  /**
   * The full content/instructions for the agent.
   * Contains the markdown content with agent directives and examples.
   */
  content: string

  /**
   * Absolute file path where the agent definition is stored.
   * Used for file watching and cache invalidation.
   */
  filePath: string

  /**
   * Timestamp when the agent definition file was last modified.
   * Used for cache invalidation and version tracking.
   */
  lastModified: Date
}

/**
 * Type guard to check if an unknown value is a valid AgentDefinition.
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid AgentDefinition
 *
 * @example
 * ```typescript
 * if (isAgentDefinition(data)) {
 *   // data is now typed as AgentDefinition
 *   console.log(data.name)
 * }
 * ```
 */
export function isAgentDefinition(value: unknown): value is AgentDefinition {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj['name'] === 'string' &&
    obj['name'].length > 0 &&
    typeof obj['description'] === 'string' &&
    obj['description'].length > 0 &&
    typeof obj['content'] === 'string' &&
    typeof obj['filePath'] === 'string' &&
    obj['filePath'].length > 0 &&
    obj['lastModified'] instanceof Date
  )
}
