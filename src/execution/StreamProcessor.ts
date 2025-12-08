/**
 * StreamProcessor - Simplified stream processing for agent output
 *
 * Handles cursor, claude, and gemini output in JSON format.
 * - Cursor/Claude: Use --output-format json, return a single JSON with type: "result"
 * - Gemini: Uses --output-format stream-json, returns multiple JSON lines,
 *           assistant messages contain the response, type: "result" signals completion
 */
export class StreamProcessor {
  private resultJson: unknown = null
  private geminiResponseParts: string[] = []
  private isGeminiStreamJson = false

  /**
   * Process a single line from the agent output stream.
   * Returns true when a valid result JSON is detected, false otherwise.
   *
   * For Cursor/Claude: The first JSON line with type: "result" is the result.
   * For Gemini stream-json: Accumulate assistant messages, return when type: "result" is seen.
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
   * Get the final result JSON.
   * @returns The stored result JSON or null if not yet available
   */
  getResult(): unknown {
    return this.resultJson
  }
}
