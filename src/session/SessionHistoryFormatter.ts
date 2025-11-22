/**
 * Session history formatter for LLM context
 *
 * Converts SessionData to Markdown format for optimal token efficiency and LLM comprehension.
 */

import type { SessionData } from '../types/SessionData'

/**
 * Formats session history as Markdown for LLM context.
 *
 * Extracts only the essential conversation flow (prompts and responses),
 * removing metadata like sessionId, timestamps, and execution details.
 *
 * @param sessionData - Session data to format
 * @returns Markdown-formatted conversation history
 *
 * @example
 * ```typescript
 * const history = formatSessionHistory(sessionData)
 * // Output:
 * // # Session History: rule-advisor
 * //
 * // ## 1. User Request
 * //
 * // Task: Fix TypeScript type errors
 * //
 * // ## 1. Agent Response
 * //
 * // To fix type errors...
 * ```
 */
export function formatSessionHistory(sessionData: SessionData): string {
  const conversations = sessionData.history
    .map((entry, index) => {
      const number = index + 1
      return `## ${number}. User Request

${entry.request.prompt}

## ${number}. Agent Response

${entry.response.stdout}`
    })
    .join('\n\n')

  return `# Session History: ${sessionData.agentType}

${conversations}`
}
