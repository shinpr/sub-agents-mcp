/**
 * StreamProcessor - Simplified stream processing for agent output
 *
 * Handles both cursor and claude output in JSON format.
 * Both agents now use --output-format json and return a single JSON response.
 */
export class StreamProcessor {
  private resultJson: unknown = null

  /**
   * Process a single line from the agent output stream.
   * Returns true when a valid JSON is detected, false otherwise.
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

    // Try to parse as JSON
    try {
      const json = JSON.parse(trimmedLine)

      // Store the first valid JSON response
      if (!this.resultJson) {
        this.resultJson = json
        return true // Processing complete
      }
      return false // Ignore subsequent JSONs
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
