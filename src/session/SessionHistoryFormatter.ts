/**
 * Session history formatter for LLM context
 *
 * Converts SessionData to Markdown format for optimal token efficiency
 * and LLM comprehension.
 *
 * Token reduction: ~52% compared to JSON
 * Format: Standard Markdown (LLM-optimized)
 */

import type { SessionData } from '../types/SessionData'

/**
 * Formats session history as Markdown for LLM context.
 *
 * Extracts only the essential conversation flow (prompts and responses),
 * removing metadata like sessionId, timestamps, and execution details.
 *
 * Benefits:
 * - 52.82% token reduction vs JSON
 * - LLM-optimized format (Markdown is well-understood by LLMs)
 * - Human-readable for debugging
 * - No escaping or compression artifacts
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
 * // タスク: TypeScript型エラー修正
 * //
 * // ## 1. Agent Response
 * //
 * // 型エラーを修正するには...
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
