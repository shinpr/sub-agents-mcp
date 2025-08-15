/**
 * Central export point for all type definitions used in the MCP server.
 *
 * This module provides type definitions for:
 * - Agent definitions and metadata
 * - Execution parameters and results
 * - Server configuration
 * - Type guards for runtime validation
 *
 * @example
 * ```typescript
 * import type { AgentDefinition, ExecutionParams } from './types'
 * import { isAgentDefinition, isExecutionParams } from './types'
 * ```
 */
export type { AgentDefinition } from './AgentDefinition'
export type { ExecutionParams, ExecutionResult } from './ExecutionParams'
export type { ServerConfigInterface } from './ServerConfig'

// Export type guards for runtime validation
export { isAgentDefinition } from './AgentDefinition'
export { isExecutionParams, isExecutionResult } from './ExecutionParams'
