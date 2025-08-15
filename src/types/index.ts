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
 * import type { AgentDefinition, ExecutionParams } from 'src/types/types'
 * import { isAgentDefinition, isExecutionParams } from 'src/types/types'
 * ```
 */
export type { AgentDefinition } from 'src/types/AgentDefinition'
export type { ExecutionParams, ExecutionResult } from 'src/types/ExecutionParams'
export type { ServerConfigInterface } from 'src/types/ServerConfig'
