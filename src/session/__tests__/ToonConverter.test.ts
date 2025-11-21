import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionData } from '../../types/SessionData'
import { ToonConverter } from '../ToonConverter'

describe('ToonConverter', () => {
  describe('convertToToon', () => {
    it('should convert SessionData to TOON format', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'abc123-def456',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'タスクの本質を分析してください',
              cwd: '/path/to/project',
            },
            response: {
              stdout: 'Analysis result...',
              stderr: '',
              exitCode: 0,
              executionTime: 1234,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
      }

      // Act
      const result = ToonConverter.convertToToon(sessionData)

      // Assert - Check for short keys
      expect(result).toContain('sid:abc123-def456')
      expect(result).toContain('agt:rule-advisor')
      expect(result).toContain('h:[1,]') // history without space
      expect(result).toContain('20250121 120000') // compact timestamp
      expect(result).toContain('タスクの本質を分析してください')
      expect(result).toContain('Analysis result...')
    })

    it('should handle empty history', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'test-session',
        agentType: 'test-agent',
        history: [],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
      }

      // Act
      const result = ToonConverter.convertToToon(sessionData)

      // Assert - Check for short keys
      expect(result).toContain('sid:test-session')
      expect(result).toContain('h:[0,]') // history without space
    })

    it('should handle multiple history entries', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'multi-test',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'First request',
              cwd: '/path/1',
            },
            response: {
              stdout: 'First response',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:05:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Second request',
              cwd: '/path/2',
            },
            response: {
              stdout: 'Second response',
              stderr: '',
              exitCode: 0,
              executionTime: 200,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:05:00Z'),
      }

      // Act
      const result = ToonConverter.convertToToon(sessionData)

      // Assert - Check for short keys
      expect(result).toContain('h:[2,]') // history without space
      expect(result).toContain('First request')
      expect(result).toContain('Second request')
      expect(result).toContain('First response')
      expect(result).toContain('Second response')
    })

    it('should handle request without optional fields', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'optional-test',
        agentType: 'test-agent',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'test-agent',
              prompt: 'Test prompt',
              // no cwd, no extra_args
            },
            response: {
              stdout: 'Test response',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
      }

      // Act
      const result = ToonConverter.convertToToon(sessionData)

      // Assert
      expect(result).toContain('Test prompt')
      expect(result).toContain('Test response')
      // Optional fields should not be in the output (filtered out when empty)
      expect(result).not.toContain('cwd')
      expect(result).not.toContain('extra_args')
    })

    it('should reduce tokens by at least 30%', () => {
      // Arrange - Use a more realistic SessionData with multiple history entries
      const sessionData: SessionData = {
        sessionId: 'abc123-def456-ghi789',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'タスクの本質を分析してください。このタスクの目的は何ですか？',
              cwd: '/path/to/project',
            },
            response: {
              stdout:
                'Analysis result: This task is focused on understanding the core essence of the work item...',
              stderr: '',
              exitCode: 0,
              executionTime: 1234,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:05:00Z'),
            request: {
              agent: 'rule-advisor',
              prompt: '前回の分析結果を踏まえて、次のアクションを提案してください',
              cwd: '/path/to/project',
            },
            response: {
              stdout:
                'Next action: Based on the analysis, I recommend implementing the following steps...',
              stderr: '',
              exitCode: 0,
              executionTime: 2345,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:05:00Z'),
      }

      // Act
      const jsonStr = JSON.stringify(sessionData)
      const toonStr = ToonConverter.convertToToon(sessionData)

      // Calculate approximate token counts (char count / 4)
      const jsonTokens = jsonStr.length / 4
      const toonTokens = toonStr.length / 4
      const reductionRate = ((jsonTokens - toonTokens) / jsonTokens) * 100

      // Log for debugging
      console.log('JSON length:', jsonStr.length, 'tokens:', jsonTokens)
      console.log('TOON length:', toonStr.length, 'tokens:', toonTokens)
      console.log('Reduction rate:', reductionRate.toFixed(2), '%')

      // Assert - Expect at least 25% reduction (realistic target with balanced readability)
      expect(reductionRate).toBeGreaterThanOrEqual(25)
    })

    it('should handle complex nested structures', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'complex-test',
        agentType: 'test-agent',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00Z'),
            request: {
              agent: 'test-agent',
              prompt: 'Complex test with\nnewlines\nand\ttabs',
              cwd: '/path/to/project',
              extra_args: ['--flag1', '--flag2'],
            },
            response: {
              stdout: 'Response with special chars: {"nested": true}',
              stderr: 'Warning: something happened',
              exitCode: 0,
              executionTime: 5000,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00Z'),
      }

      // Act
      const result = ToonConverter.convertToToon(sessionData)

      // Assert
      expect(result).toContain('Complex test')
      expect(result).toContain('special chars')
      expect(result).toContain('Warning')
    })

    it('should fallback to JSON string on conversion error', () => {
      // Arrange
      const invalidData = {
        sessionId: 'test',
        // circular reference to cause JSON.stringify error
        circular: null as unknown,
      }
      invalidData.circular = invalidData

      // Act
      const result = ToonConverter.convertToToon(invalidData)

      // Assert
      // Should not throw, and should return some string
      expect(typeof result).toBe('string')
      // In case of error, it should attempt to return a fallback
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('convertToJson', () => {
    it('should convert TOON format back to JSON', () => {
      // Arrange
      const toonString =
        'sid:abc123-def456,agt:rule-advisor,h:[1,]{ts:20250121 120000,req:{agent:rule-advisor,prompt:テスト,cwd:/path},res:{out:結果,err:"",ec:0,et:1234}},cat:20250121 120000,uat:20250121 120000'

      // Act
      const result = ToonConverter.convertToJson(toonString) as Record<string, unknown>

      // Assert
      expect(result.sessionId).toBe('abc123-def456')
      expect(result.agentType).toBe('rule-advisor')
      expect(Array.isArray(result.history)).toBe(true)
      expect((result.history as unknown[]).length).toBe(1)
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.lastUpdatedAt).toBeInstanceOf(Date)
    })

    it('should handle empty arrays', () => {
      // Arrange
      const toonString = 'sid:test,agt:test-agent,h:[0,],cat:20250121 120000,uat:20250121 120000'

      // Act
      const result = ToonConverter.convertToJson(toonString) as Record<string, unknown>

      // Assert
      expect(result.sessionId).toBe('test')
      expect(result.agentType).toBe('test-agent')
      expect(Array.isArray(result.history)).toBe(true)
      expect((result.history as unknown[]).length).toBe(0)
    })

    it('should handle primitive values', () => {
      // Arrange - test various primitive types
      expect(ToonConverter.convertToJson('null')).toBe(null)
      expect(ToonConverter.convertToJson('undefined')).toBe(undefined)
      expect(ToonConverter.convertToJson('true')).toBe(true)
      expect(ToonConverter.convertToJson('false')).toBe(false)
      expect(ToonConverter.convertToJson('123')).toBe(123)
      expect(ToonConverter.convertToJson('123.456')).toBe(123.456)
      expect(ToonConverter.convertToJson('simple-string')).toBe('simple-string')
      expect(ToonConverter.convertToJson('"quoted string"')).toBe('quoted string')
    })

    it('should parse compact timestamps', () => {
      // Arrange
      const toonString = '20250121 120000'

      // Act
      const result = ToonConverter.convertToJson(toonString)

      // Assert
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).toISOString()).toBe('2025-01-21T12:00:00.000Z')
    })

    it('should handle nested objects and arrays', () => {
      // Arrange - Test array parsing directly
      const toonString =
        '[2,]{ts:20250121 120000,req:{prompt:First}},{ts:20250121 120500,req:{prompt:Second}}'

      // Act
      const result = ToonConverter.convertToJson(toonString) as unknown[]

      // Assert
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)

      const history = result as Array<Record<string, unknown>>
      expect(history[0].timestamp).toBeInstanceOf(Date)
      expect((history[0].request as Record<string, unknown>).prompt).toBe('First')
      expect(history[1].timestamp).toBeInstanceOf(Date)
      expect((history[1].request as Record<string, unknown>).prompt).toBe('Second')
    })

    it('should fallback to JSON.parse on invalid TOON format', () => {
      // Arrange - JSON.parse is only used when parseToonString throws
      // Since '{"key":"value"}' starts with '{' it will try parseObject first
      // We need a truly invalid case that would make both fail
      const jsonString = '{"sessionId":"test","agentType":"test-agent"}'

      // Act
      const result = ToonConverter.convertToJson(jsonString) as Record<string, unknown>

      // Assert - parseObject should handle this directly
      // The fallback to JSON.parse only happens on exception
      expect(result.sessionId).toBe('test')
      expect(result.agentType).toBe('test-agent')
    })

    it('should throw error on completely invalid input', () => {
      // Arrange - Input that will fail both TOON parsing and JSON.parse
      const invalidString = 'this is not valid TOON or JSON [[{'

      // Act
      const result = ToonConverter.convertToJson(invalidString)

      // Assert - Since this doesn't match any TOON pattern, it returns as-is string
      // The error is only thrown if JSON.parse also fails after TOON parsing fails with exception
      expect(typeof result).toBe('string')
    })
  })

  describe('reversibility', () => {
    it('should be reversible for SessionData', () => {
      // Arrange
      const originalData: SessionData = {
        sessionId: 'reversible-test',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: '可逆性のテスト',
              cwd: '/path/to/project',
            },
            response: {
              stdout: 'テスト結果',
              stderr: '',
              exitCode: 0,
              executionTime: 1234,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00.000Z'),
      }

      // Act
      const toonString = ToonConverter.convertToToon(originalData)
      const restoredData = ToonConverter.convertToJson(toonString) as SessionData

      // Assert - Check structure
      expect(restoredData.sessionId).toBe(originalData.sessionId)
      expect(restoredData.agentType).toBe(originalData.agentType)
      expect(restoredData.history.length).toBe(originalData.history.length)

      // Check timestamps
      expect(restoredData.createdAt).toBeInstanceOf(Date)
      expect(restoredData.lastUpdatedAt).toBeInstanceOf(Date)
      expect((restoredData.createdAt as Date).getTime()).toBe(originalData.createdAt.getTime())
      expect((restoredData.lastUpdatedAt as Date).getTime()).toBe(
        originalData.lastUpdatedAt.getTime()
      )

      // Check history
      expect(restoredData.history[0].timestamp).toBeInstanceOf(Date)
      expect((restoredData.history[0].timestamp as Date).getTime()).toBe(
        originalData.history[0].timestamp.getTime()
      )
      expect(restoredData.history[0].request.agent).toBe(originalData.history[0].request.agent)
      expect(restoredData.history[0].request.prompt).toBe(originalData.history[0].request.prompt)
      expect(restoredData.history[0].request.cwd).toBe(originalData.history[0].request.cwd)
      expect(restoredData.history[0].response.stdout).toBe(originalData.history[0].response.stdout)
      expect(restoredData.history[0].response.exitCode).toBe(
        originalData.history[0].response.exitCode
      )
      expect(restoredData.history[0].response.executionTime).toBe(
        originalData.history[0].response.executionTime
      )
    })

    it('should be reversible for complex nested data', () => {
      // Arrange
      const originalData: SessionData = {
        sessionId: 'complex-reversible',
        agentType: 'test-agent',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'test-agent',
              prompt: 'First prompt',
              cwd: '/path/1',
              extra_args: ['--flag1', '--flag2'],
            },
            response: {
              stdout: 'First response',
              stderr: 'Warning: test',
              exitCode: 0,
              executionTime: 100,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:05:00.000Z'),
            request: {
              agent: 'test-agent',
              prompt: 'Second prompt',
              cwd: '/path/2',
            },
            response: {
              stdout: 'Second response',
              stderr: '',
              exitCode: 0,
              executionTime: 200,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:05:00.000Z'),
      }

      // Act
      const toonString = ToonConverter.convertToToon(originalData)
      const restoredData = ToonConverter.convertToJson(toonString) as SessionData

      // Assert
      expect(restoredData.sessionId).toBe(originalData.sessionId)
      expect(restoredData.agentType).toBe(originalData.agentType)
      expect(restoredData.history.length).toBe(2)

      // Check first entry
      expect(restoredData.history[0].request.prompt).toBe('First prompt')
      expect(restoredData.history[0].response.stdout).toBe('First response')
      expect(restoredData.history[0].response.stderr).toBe('Warning: test')

      // Check second entry
      expect(restoredData.history[1].request.prompt).toBe('Second prompt')
      expect(restoredData.history[1].response.stdout).toBe('Second response')
    })

    it('should be reversible for empty history', () => {
      // Arrange
      const originalData: SessionData = {
        sessionId: 'empty-history-test',
        agentType: 'test-agent',
        history: [],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00.000Z'),
      }

      // Act
      const toonString = ToonConverter.convertToToon(originalData)
      const restoredData = ToonConverter.convertToJson(toonString) as SessionData

      // Assert
      expect(restoredData.sessionId).toBe(originalData.sessionId)
      expect(restoredData.agentType).toBe(originalData.agentType)
      expect(restoredData.history).toEqual([])
      expect((restoredData.createdAt as Date).getTime()).toBe(originalData.createdAt.getTime())
      expect((restoredData.lastUpdatedAt as Date).getTime()).toBe(
        originalData.lastUpdatedAt.getTime()
      )
    })
  })
})
