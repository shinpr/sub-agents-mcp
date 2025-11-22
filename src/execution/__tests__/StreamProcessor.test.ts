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

    it('should ignore subsequent JSONs after the first one', () => {
      const json1 = '{"response": "First JSON", "status": "success"}'
      const json2 = '{"response": "Second JSON", "status": "also success"}'

      expect(processor.processLine(json1)).toBe(true)
      expect(processor.processLine(json2)).toBe(false)

      // Should still have the first JSON
      expect(processor.getResult()).toEqual({
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
      const claudeJson = '{"response": "Claude output", "status": "complete"}'

      expect(processor.processLine(claudeJson)).toBe(true)
      expect(processor.getResult()).toEqual({
        response: 'Claude output',
        status: 'complete',
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
      expect(processor.processLine('null')).toBe(true) // null is valid JSON
      expect(processor.getResult()).toBe(null) // but stored as null
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
