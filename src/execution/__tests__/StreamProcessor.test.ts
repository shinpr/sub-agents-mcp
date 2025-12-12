import { StreamProcessor } from '../StreamProcessor'

describe('StreamProcessor', () => {
  let processor: StreamProcessor

  beforeEach(() => {
    processor = new StreamProcessor()
  })

  describe('JSON processing', () => {
    it('should detect and store the first valid JSON', () => {
      const json = '{"type": "result", "data": "output", "status": "complete"}'

      expect(processor.processLine(json)).toBe(true)
      expect(processor.getResult()).toEqual({
        type: 'result',
        data: 'output',
        status: 'complete',
      })
    })

    it('should ignore subsequent JSONs after finding result type', () => {
      const json1 = '{"type": "result", "response": "First JSON", "status": "success"}'
      const json2 = '{"type": "result", "response": "Second JSON", "status": "also success"}'

      expect(processor.processLine(json1)).toBe(true)
      expect(processor.processLine(json2)).toBe(false)

      // Should still have the first JSON
      expect(processor.getResult()).toEqual({
        type: 'result',
        response: 'First JSON',
        status: 'success',
      })
    })

    it('should handle cursor-agent JSON format', () => {
      const cursorJson =
        '{"type":"result","subtype":"success","is_error":false,"duration_ms":6928,"result":"4","session_id":"bf18d32c-fd61-4890-b7ba-bd64effd86bd","request_id":"9f5d1b48-9338-4bc0-ab87-8f9d2a22965a"}'

      expect(processor.processLine(cursorJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 6928,
        result: '4',
        session_id: 'bf18d32c-fd61-4890-b7ba-bd64effd86bd',
        request_id: '9f5d1b48-9338-4bc0-ab87-8f9d2a22965a',
      })
    })

    it('should handle cursor-agent error JSON format', () => {
      const cursorErrorJson =
        '{"type":"result","subtype":"error","is_error":true,"duration_ms":1234,"error":"エラーが発生しました","error_type":"execution_error","session_id":"bf18d32c-fd61-4890-b7ba-bd64effd86bd","request_id":"9f5d1b48-9338-4bc0-ab87-8f9d2a22965a"}'

      expect(processor.processLine(cursorErrorJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        type: 'result',
        subtype: 'error',
        is_error: true,
        duration_ms: 1234,
        error: 'エラーが発生しました',
        error_type: 'execution_error',
        session_id: 'bf18d32c-fd61-4890-b7ba-bd64effd86bd',
        request_id: '9f5d1b48-9338-4bc0-ab87-8f9d2a22965a',
      })
    })

    it('should handle claude JSON format', () => {
      const claudeJson =
        '{"type":"result","subtype":"success","is_error":false,"duration_ms":2856,"result":"Hi!","session_id":"711419a4-3a19-4448-aa4a-31de7c4fa7a5"}'

      expect(processor.processLine(claudeJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 2856,
        result: 'Hi!',
        session_id: '711419a4-3a19-4448-aa4a-31de7c4fa7a5',
      })
    })

    it('should handle gemini stream-json format by accumulating assistant messages', () => {
      // Gemini stream-json outputs multiple JSON lines:
      // - init: signals stream-json mode
      // - message with role: "user": user prompt (ignored)
      // - message with role: "assistant": response content (accumulated)
      // - result: signals completion with stats
      const initJson =
        '{"type":"init","timestamp":"2025-12-08T01:58:05.481Z","session_id":"abc123","model":"auto"}'
      const userMessageJson =
        '{"type":"message","timestamp":"2025-12-08T01:58:05.481Z","role":"user","content":"say hello"}'
      const assistantDelta1 =
        '{"type":"message","timestamp":"2025-12-08T01:58:09.614Z","role":"assistant","content":"Hello! ","delta":true}'
      const assistantDelta2 =
        '{"type":"message","timestamp":"2025-12-08T01:58:09.642Z","role":"assistant","content":"How can I help you?","delta":true}'
      const resultJson =
        '{"type":"result","timestamp":"2025-12-08T01:58:09.651Z","status":"success","stats":{"total_tokens":100}}'

      // init signals Gemini stream-json mode
      expect(processor.processLine(initJson)).toBe(false)
      // user message is ignored
      expect(processor.processLine(userMessageJson)).toBe(false)
      // assistant messages are accumulated
      expect(processor.processLine(assistantDelta1)).toBe(false)
      expect(processor.processLine(assistantDelta2)).toBe(false)

      // Result type should return true and include accumulated response
      expect(processor.processLine(resultJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        type: 'result',
        result: 'Hello! How can I help you?',
        status: 'success',
        stats: { total_tokens: 100 },
      })
    })

    it('should handle JSON without type field for backwards compatibility', () => {
      const legacyJson = '{"response": "Legacy output", "status": "complete"}'

      expect(processor.processLine(legacyJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        response: 'Legacy output',
        status: 'complete',
      })
    })

    it('should extract agent_message text from codex output stream', () => {
      // Given: A complete Codex output stream with reasoning and agent_message
      const codexOutputStream = [
        '{"type":"thread.started","thread_id":"019b1291-a763-74a1-bffe-39670dad4b6b"}',
        '{"type":"turn.started"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Responding to greeting**"}}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"こんにちは！今日はどうしますか？"}}',
        '{"type":"turn.completed","usage":{"input_tokens":3482,"cached_input_tokens":3072,"output_tokens":13}}',
      ]

      // When: Processing the entire stream
      for (const line of codexOutputStream) {
        processor.processLine(line)
      }

      // Then: Result contains only the agent_message text
      expect(processor.getResult()).toEqual({
        type: 'result',
        result: 'こんにちは！今日はどうしますか？',
        usage: { input_tokens: 3482, cached_input_tokens: 3072, output_tokens: 13 },
        status: 'success',
      })
    })

    it('should concatenate multiple agent_messages with newlines', () => {
      // Given: Codex output with multiple agent_message items
      const codexOutputStream = [
        '{"type":"thread.started","thread_id":"019b1292-47b5-7bf3-8f7a-ef0986d5b982"}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Message 1"}}',
        '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Message 2"}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}',
      ]

      // When: Processing the stream
      for (const line of codexOutputStream) {
        processor.processLine(line)
      }

      // Then: Messages are joined with newlines
      expect(processor.getResult()).toEqual({
        type: 'result',
        result: 'Message 1\nMessage 2',
        usage: { input_tokens: 100, output_tokens: 20 },
        status: 'success',
      })
    })

    it('should ignore command_execution items and only include agent_message', () => {
      // Given: Codex output with command execution (reasoning, command, then summary)
      const codexOutputStream = [
        '{"type":"thread.started","thread_id":"019b1292-e66c-7c61-bcc5-4262b08f3535"}',
        '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Listing sandbox contents**"}}',
        '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls"}}',
        '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"file1\\nfile2\\n","exit_code":0}}',
        '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Files: file1, file2"}}',
        '{"type":"turn.completed","usage":{"input_tokens":500,"output_tokens":50}}',
      ]

      // When: Processing the stream
      for (const line of codexOutputStream) {
        processor.processLine(line)
      }

      // Then: Only agent_message content is in the result
      expect(processor.getResult()).toEqual({
        type: 'result',
        result: 'Files: file1, file2',
        usage: { input_tokens: 500, output_tokens: 50 },
        status: 'success',
      })
    })
  })

  describe('Line handling', () => {
    it('should ignore empty lines', () => {
      expect(processor.processLine('')).toBe(false)
      expect(processor.processLine('   ')).toBe(false)
      expect(processor.processLine('\n')).toBe(false)
      expect(processor.getResult()).toBeNull()
    })

    it('should ignore non-JSON lines', () => {
      expect(processor.processLine('plain text output')).toBe(false)
      expect(processor.processLine('Error: something went wrong')).toBe(false)
      expect(processor.processLine('Starting agent...')).toBe(false)
      expect(processor.getResult()).toBeNull()
    })

    it('should handle malformed JSON gracefully', () => {
      expect(processor.processLine('{invalid json')).toBe(false)
      expect(processor.processLine('{"incomplete": ')).toBe(false)
      // null is valid JSON but not an object with type field, so it's ignored
      expect(processor.processLine('null')).toBe(false)
      expect(processor.getResult()).toBeNull()
    })
  })

  describe('Edge cases', () => {
    it('should handle complex nested JSON structures', () => {
      const complexJson =
        '{"foo": "bar", "nested": {"deep": {"value": "test"}}, "array": [1, 2, 3]}'

      expect(processor.processLine(complexJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        foo: 'bar',
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
      })
    })

    it('should handle JSON with special characters', () => {
      const jsonWithSpecialChars = '{"text": "Line 1\\nLine 2\\tTabbed", "emoji": "🎉"}'

      expect(processor.processLine(jsonWithSpecialChars)).toBe(true)
      expect(processor.getResult()).toEqual({
        text: 'Line 1\nLine 2\tTabbed',
        emoji: '🎉',
      })
    })

    it('should process lines with leading/trailing whitespace', () => {
      const jsonWithWhitespace = '  {"data": "value"}  '

      expect(processor.processLine(jsonWithWhitespace)).toBe(true)
      expect(processor.getResult()).toEqual({
        data: 'value',
      })
    })
  })
})
