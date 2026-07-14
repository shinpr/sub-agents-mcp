/**
 * StreamProcessor - Simplified stream processing for agent output
 *
 * Handles cursor, claude, gemini, codex, grok, and OpenCode output in JSON format.
 * - Cursor/Claude: Use --output-format json, return a single JSON with type: "result"
 * - Gemini: Uses --output-format stream-json, returns multiple JSON lines,
 *           assistant messages contain the response, type: "result" signals completion
 * - Codex: Uses --json flag with exec subcommand, returns stream of JSON events,
 *          agent_message items contain the response, turn.completed signals completion
 * - Grok: Uses --output-format json, returns a complete JSON object after exit
 * - OpenCode: Uses --format json, returns step and text events as NDJSON
 */
export class StreamProcessor {
  private resultJson: unknown = null
  private geminiResponseParts: string[] = []
  private isGeminiStreamJson = false
  private isCodexFormat = false
  private codexAgentMessages: string[] = []
  private codexUsage: unknown = null
  private isOpenCodeFormat = false
  private openCodeResponseParts: string[] = []

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

      const part = json['part']
      if (
        ['step_start', 'tool_use', 'text', 'step_finish'].includes(String(json['type'])) &&
        this.isRecord(part)
      ) {
        this.isOpenCodeFormat = true
      }

      const normalizedError = this.normalizeFatalError(json)
      if (normalizedError) {
        this.resultJson = normalizedError
        return true
      }

      if (this.isOpenCodeFormat && json['type'] === 'text' && this.isRecord(part)) {
        if (typeof part['text'] === 'string') {
          this.openCodeResponseParts.push(part['text'])
        }
        return false
      }

      if (this.isOpenCodeFormat && json['type'] === 'step_finish' && this.isRecord(part)) {
        const reason = part['reason']
        if (reason === 'tool-calls' || reason === undefined || reason === null) {
          return false
        }
        this.resultJson = {
          type: 'result',
          result: this.openCodeResponseParts.join(''),
          status: reason === 'stop' ? 'success' : 'partial',
          stop_reason: reason,
        }
        return true
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

      const normalizedCompleteOutput = this.normalizeCompleteOutput(json)
      if (normalizedCompleteOutput) {
        this.resultJson = normalizedCompleteOutput
        return true
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
   * Process a complete non-NDJSON payload after process exit.
   *
   * Grok's `--output-format json` can emit a pretty-printed JSON object, which
   * cannot be parsed by the line-oriented stream path.
   *
   * @param output - Complete stdout captured from the agent process
   * @returns true if processing is complete, false otherwise
   */
  processCompleteOutput(output: string): boolean {
    if (this.resultJson !== null) {
      return false
    }

    try {
      const json = JSON.parse(output.trim()) as unknown
      if (this.isRecord(json)) {
        const normalizedError = this.normalizeFatalError(json)
        if (normalizedError) {
          this.resultJson = normalizedError
          return true
        }

        const normalizedCompleteOutput = this.normalizeCompleteOutput(json)
        if (normalizedCompleteOutput) {
          this.resultJson = normalizedCompleteOutput
          return true
        }
      }
    } catch {
      // NDJSON streams are expected to fail whole-output JSON parsing.
    }

    if (this.isOpenCodeFormat && this.openCodeResponseParts.length > 0) {
      this.resultJson = {
        type: 'result',
        result: this.openCodeResponseParts.join(''),
        status: 'partial',
        stop_reason: 'process-exit',
      }
      return true
    }

    return false
  }

  private normalizeFatalError(json: Record<string, unknown>): Record<string, unknown> | null {
    const isFatalEvent =
      json['type'] === 'error' ||
      json['type'] === 'turn.failed' ||
      (json['type'] === 'result' && json['status'] === 'error')

    if (!isFatalEvent) {
      return null
    }

    const error = this.isRecord(json['error']) ? json['error'] : undefined
    const errorData = error && this.isRecord(error['data']) ? error['data'] : undefined
    const message =
      (typeof json['message'] === 'string' && json['message']) ||
      (error && typeof error['message'] === 'string' && error['message']) ||
      (errorData && typeof errorData['message'] === 'string' && errorData['message']) ||
      (typeof json['error'] === 'string' && json['error']) ||
      'Agent execution failed'
    const errorType =
      (error && typeof error['name'] === 'string' && error['name']) ||
      (error && typeof error['type'] === 'string' && error['type'])
    const errorRef =
      (errorData && typeof errorData['ref'] === 'string' && errorData['ref']) ||
      (error && typeof error['ref'] === 'string' && error['ref']) ||
      (typeof json['ref'] === 'string' && json['ref'])
    const sessionId =
      (typeof json['sessionID'] === 'string' && json['sessionID']) ||
      (typeof json['session_id'] === 'string' && json['session_id'])

    const context: string[] = []
    if (errorRef) context.push(`ref: ${errorRef}`)
    if (sessionId) context.push(`sessionID: ${sessionId}`)
    const formattedMessage = `${errorType ? `${errorType}: ` : ''}${message}${
      context.length > 0 ? ` (${context.join(', ')})` : ''
    }`

    return {
      type: 'result',
      subtype: 'error',
      is_error: true,
      error: formattedMessage,
      ...(errorType && { error_type: errorType }),
      ...(errorRef && { error_ref: errorRef }),
      ...(sessionId && { session_id: sessionId }),
      ...(json['stats'] !== undefined && { stats: json['stats'] }),
    }
  }

  private normalizeCompleteOutput(json: Record<string, unknown>): Record<string, unknown> | null {
    if (typeof json['text'] !== 'string' || !('stopReason' in json)) {
      return null
    }

    const result: Record<string, unknown> = {
      type: 'result',
      result: json['text'],
      status: json['stopReason'] === 'EndTurn' ? 'success' : 'partial',
    }

    if (typeof json['stopReason'] === 'string') {
      result['stop_reason'] = json['stopReason']
    }
    if (typeof json['sessionId'] === 'string') {
      result['session_id'] = json['sessionId']
    }
    if (typeof json['requestId'] === 'string') {
      result['request_id'] = json['requestId']
    }

    return result
  }

  /**
   * Type guard for Codex item structure
   * @param item - The item to check
   * @returns true if item is a valid Codex item object
   */
  private isCodexItem(item: unknown): item is Record<string, unknown> {
    return this.isRecord(item)
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /**
   * Get the final result JSON.
   * @returns The stored result JSON or null if not yet available
   */
  getResult(): unknown {
    return this.resultJson
  }
}
