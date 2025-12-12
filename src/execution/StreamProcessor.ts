/**
 * StreamProcessor - Simplified stream processing for agent output
 *
 * Handles cursor, claude, gemini, and codex output in JSON format.
 * - Cursor/Claude: Use --output-format json, return a single JSON with type: "result"
 * - Gemini: Uses --output-format stream-json, returns multiple JSON lines,
 *           assistant messages contain the response, type: "result" signals completion
 * - Codex: Uses --json flag with exec subcommand, returns stream of JSON events,
 *          agent_message items contain the response, turn.completed signals completion
 */
export class StreamProcessor {
  private resultJson: unknown = null
  private geminiResponseParts: string[] = []
  private isGeminiStreamJson = false
  private isCodexFormat = false
  private codexAgentMessages: string[] = []
  private codexUsage: unknown = null

  /**
   * Process a single line from the agent output stream.
   * Returns true when a valid result JSON is detected, false otherwise.
   *
   * For Cursor/Claude: The first JSON line with type: "result" is the result.
   * For Gemini stream-json: Accumulate assistant messages, return when type: "result" is seen.
   * For Codex: Accumulate agent_message items, return when turn.completed is seen.
   *
   * @param line - Raw line from stdout
   * @returns true if processing is complete, false to continue
   */
  processLine(line: string): boolean {
    const trimmedLine = line.trim()

    // Empty lines are ignored
    if (!trimmedLine) {
      return false
    }

    // If we already have a result, ignore subsequent lines
    if (this.resultJson !== null) {
      return false
    }

    // Try to parse as JSON
    try {
      const json = JSON.parse(trimmedLine) as Record<string, unknown>

      // Detect Gemini stream-json format by init message
      if (json['type'] === 'init') {
        this.isGeminiStreamJson = true
        return false
      }

      // Detect Codex format by thread.started message
      if (json['type'] === 'thread.started') {
        this.isCodexFormat = true
        return false
      }

      // For Gemini: accumulate assistant message content
      if (
        this.isGeminiStreamJson &&
        json['type'] === 'message' &&
        json['role'] === 'assistant' &&
        typeof json['content'] === 'string'
      ) {
        this.geminiResponseParts.push(json['content'])
        return false
      }

      // For Codex: accumulate agent_message content from item.completed events
      if (this.isCodexFormat && json['type'] === 'item.completed') {
        const item = json['item']
        if (
          this.isCodexItem(item) &&
          item['type'] === 'agent_message' &&
          typeof item['text'] === 'string'
        ) {
          this.codexAgentMessages.push(item['text'])
        }
        return false
      }

      // For Codex: turn.completed signals end of response
      if (this.isCodexFormat && json['type'] === 'turn.completed') {
        this.codexUsage = json['usage']
        this.resultJson = {
          type: 'result',
          result: this.codexAgentMessages.join('\n'),
          usage: this.codexUsage,
          status: 'success',
        }
        return true // Processing complete
      }

      // Check if this is a result JSON
      if (json['type'] === 'result') {
        // For Gemini: construct result with accumulated response
        if (this.isGeminiStreamJson) {
          this.resultJson = {
            type: 'result',
            result: this.geminiResponseParts.join(''),
            stats: json['stats'],
            status: json['status'],
          }
        } else {
          // Cursor/Claude: use as-is
          this.resultJson = json
        }
        return true // Processing complete
      }

      // For backwards compatibility: store first valid JSON if no type field
      // This handles any CLI that doesn't use the type field
      if (!('type' in json)) {
        this.resultJson = json
        return true
      }

      return false // Continue processing (not a result type)
    } catch {
      // Not valid JSON, ignore
      return false
    }
  }

  /**
   * Type guard for Codex item structure
   * @param item - The item to check
   * @returns true if item is a valid Codex item object
   */
  private isCodexItem(item: unknown): item is Record<string, unknown> {
    return typeof item === 'object' && item !== null
  }

  /**
   * Get the final result JSON.
   * @returns The stored result JSON or null if not yet available
   */
  getResult(): unknown {
    return this.resultJson
  }
}
