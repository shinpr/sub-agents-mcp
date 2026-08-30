import type { AgentType } from './AgentExecutor.js'

export class StreamProcessor {
  private resultJson: unknown = null
  private geminiResponseParts: string[] = []
  private codexAgentMessages: string[] = []
  private openCodeResponseParts: string[] = []

  constructor(private readonly agentType: AgentType) {}

  processLine(line: string): boolean {
    const trimmedLine = line.trim()
    if (!trimmedLine || this.resultJson !== null) {
      return false
    }

    let json: unknown
    try {
      json = JSON.parse(trimmedLine) as unknown
    } catch {
      return false
    }

    if (!this.isRecord(json)) {
      return false
    }

    const agentType = this.agentType
    switch (agentType) {
      case 'cursor':
      case 'claude':
      case 'glm':
      case 'kimi':
        return this.processClaudeCompatibleLine(json)
      case 'gemini':
        return this.processGeminiLine(json)
      case 'codex':
        return this.processCodexLine(json)
      case 'grok':
        return this.processGrokLine(json)
      case 'antigravity':
        return this.processAntigravityLine(json)
      case 'opencode':
        return this.processOpenCodeLine(json)
      case 'command-code':
        return this.processCommandCodeLine(json)
      default: {
        const unsupportedAgentType: never = agentType
        throw new Error(`Unsupported agent type: ${String(unsupportedAgentType)}`)
      }
    }
  }

  processCompleteOutput(output: string): boolean {
    if (this.resultJson !== null) {
      return false
    }

    if (this.agentType === 'opencode' && this.openCodeResponseParts.length > 0) {
      this.resultJson = {
        type: 'result',
        result: this.openCodeResponseParts.join(''),
        status: 'partial',
        stop_reason: 'process-exit',
      }
      return true
    }

    if (this.agentType !== 'grok') {
      return false
    }

    try {
      const json = JSON.parse(output.trim()) as unknown
      return this.isRecord(json) && this.processGrokLine(json)
    } catch {
      return false
    }
  }

  private processClaudeCompatibleLine(json: Record<string, unknown>): boolean {
    if (json['type'] !== 'result') {
      return false
    }

    const subtype = json['subtype']
    const isError =
      json['is_error'] === true ||
      json['status'] === 'error' ||
      (typeof subtype === 'string' && subtype.startsWith('error_'))

    if (isError) {
      const normalizedError = this.normalizeError(json)
      const errorMessage =
        (typeof json['error'] === 'string' && json['error']) ||
        (typeof json['result'] === 'string' && json['result']) ||
        normalizedError['error']
      this.resultJson = {
        ...json,
        ...normalizedError,
        subtype: typeof subtype === 'string' ? subtype : 'error',
        status: 'error',
        error: errorMessage,
      }
      return true
    }

    if (typeof json['result'] !== 'string') {
      return false
    }

    this.resultJson = json
    return true
  }

  private processGeminiLine(json: Record<string, unknown>): boolean {
    if (
      json['type'] === 'message' &&
      json['role'] === 'assistant' &&
      typeof json['content'] === 'string'
    ) {
      this.geminiResponseParts.push(json['content'])
      return false
    }

    if (json['type'] !== 'result') {
      return false
    }

    if (json['status'] === 'error') {
      this.resultJson = this.normalizeError(json)
      return true
    }

    this.resultJson = {
      type: 'result',
      result: this.geminiResponseParts.join(''),
      stats: json['stats'],
      status: json['status'],
    }
    return true
  }

  private processCodexLine(json: Record<string, unknown>): boolean {
    if (json['type'] === 'error' || json['type'] === 'turn.failed') {
      this.resultJson = this.normalizeError(json)
      return true
    }

    if (json['type'] === 'item.completed') {
      const item = json['item']
      if (
        this.isRecord(item) &&
        item['type'] === 'agent_message' &&
        typeof item['text'] === 'string'
      ) {
        this.codexAgentMessages.push(item['text'])
      }
      return false
    }

    if (json['type'] !== 'turn.completed') {
      return false
    }

    this.resultJson = {
      type: 'result',
      result: this.codexAgentMessages.join('\n'),
      usage: json['usage'],
      status: 'success',
    }
    return true
  }

  private processGrokLine(json: Record<string, unknown>): boolean {
    if (json['type'] === 'error') {
      this.resultJson = this.normalizeError(json)
      return true
    }

    const result = this.normalizeGrokOutput(json)
    if (!result) {
      return false
    }

    this.resultJson = result
    return true
  }

  private processAntigravityLine(json: Record<string, unknown>): boolean {
    if (json['event'] !== 'result') {
      return false
    }

    const payload = json['result']
    if (!this.isRecord(payload) || typeof payload['response'] !== 'string') {
      return false
    }

    const status = payload['status']
    if (status === 'SUCCESS') {
      this.resultJson = {
        type: 'result',
        result: payload['response'],
        status: 'success',
      }
      return true
    }

    if (
      status === 'CANCELED' ||
      status === 'INTERRUPTED' ||
      status === 'WAITING' ||
      status === 'RUNNING'
    ) {
      this.resultJson = {
        type: 'result',
        result: payload['response'],
        status: 'partial',
      }
      return true
    }

    const error =
      (typeof payload['error'] === 'string' && payload['error']) ||
      payload['response'] ||
      `Antigravity execution failed with status: ${typeof status === 'string' ? status : 'UNKNOWN'}`
    this.resultJson = {
      type: 'result',
      subtype: 'error',
      is_error: true,
      status: 'error',
      error,
    }
    return true
  }

  private processOpenCodeLine(json: Record<string, unknown>): boolean {
    if (json['type'] === 'error') {
      this.resultJson = this.normalizeError(json)
      return true
    }

    const part = json['part']
    if (!this.isRecord(part)) {
      return false
    }

    if (json['type'] === 'text') {
      if (typeof part['text'] === 'string') {
        this.openCodeResponseParts.push(part['text'])
      }
      return false
    }

    if (json['type'] !== 'step_finish') {
      return false
    }

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

  private processCommandCodeLine(json: Record<string, unknown>): boolean {
    if (json['type'] !== 'result') {
      return false
    }

    const subtype = json['subtype']
    if (subtype === 'success' || subtype === 'max_turns') {
      const result: Record<string, unknown> = {
        type: 'result',
        result: typeof json['finalText'] === 'string' ? json['finalText'] : '',
        status: subtype === 'success' ? 'success' : 'partial',
      }
      if (typeof json['stopReason'] === 'string') {
        result['stop_reason'] = json['stopReason']
      }
      if (typeof json['sessionId'] === 'string') {
        result['session_id'] = json['sessionId']
      }
      this.resultJson = result
      return true
    }

    this.resultJson = {
      type: 'result',
      subtype: 'error',
      is_error: true,
      status: 'error',
      error:
        typeof json['error'] === 'string'
          ? json['error']
          : `Command Code execution failed${typeof subtype === 'string' ? `: ${subtype}` : ''}`,
    }
    return true
  }

  private normalizeError(json: Record<string, unknown>): Record<string, unknown> {
    const error = this.isRecord(json['error']) ? json['error'] : undefined
    const errorData = error && this.isRecord(error['data']) ? error['data'] : undefined
    const message =
      (typeof json['message'] === 'string' && json['message']) ||
      (error && typeof error['message'] === 'string' && error['message']) ||
      (errorData && typeof errorData['message'] === 'string' && errorData['message']) ||
      (typeof json['error'] === 'string' && json['error']) ||
      (typeof json['result'] === 'string' && json['result']) ||
      (typeof json['subtype'] === 'string' && json['subtype']) ||
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

  private normalizeGrokOutput(json: Record<string, unknown>): Record<string, unknown> | null {
    if (typeof json['text'] !== 'string') {
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  getResult(): unknown {
    return this.resultJson
  }
}
