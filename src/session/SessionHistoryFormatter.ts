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

      // Extract only the 'result' field from agent response (removing metadata)
      let agentResponse = entry.response.stdout
      try {
        const parsed = JSON.parse(entry.response.stdout)
        if (parsed && typeof parsed === 'object' && 'result' in parsed) {
          agentResponse = String(parsed.result)
        }
      } catch {
        // If parsing fails, use the raw stdout as fallback
        // This ensures backward compatibility and error resilience
      }

      return `## ${number}. User Request

${entry.request.prompt}

## ${number}. Agent Response

${agentResponse}`
    })
    .join('\n\n')

  return `# Session History: ${sessionData.agentType}

${conversations}`
}
