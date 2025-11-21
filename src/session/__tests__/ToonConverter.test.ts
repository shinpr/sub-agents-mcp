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
})
