import { describe, expect, it } from 'vitest'
import type { SessionData } from '../../types/SessionData'
import { formatSessionHistory } from '../SessionHistoryFormatter'

describe('SessionHistoryFormatter', () => {
  describe('formatSessionHistory', () => {
    it('should format session history as Markdown', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'test-session-123',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Task: Fix TypeScript type errors',
              cwd: '/path/to/project',
            },
            response: {
              stdout: 'Please fix the type errors',
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
      const result = formatSessionHistory(sessionData)

      // Assert
      expect(result).toContain('# Session History: rule-advisor')
      expect(result).toContain('## 1. User Request')
      expect(result).toContain('Task: Fix TypeScript type errors')
      expect(result).toContain('## 1. Agent Response')
      expect(result).toContain('Please fix the type errors')
    })

    it('should handle multiple history entries', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'multi-session',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'First question',
            },
            response: {
              stdout: 'First answer',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:05:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Second question',
            },
            response: {
              stdout: 'Second answer',
              stderr: '',
              exitCode: 0,
              executionTime: 200,
            },
          },
          {
            timestamp: new Date('2025-01-21T12:10:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Third question',
            },
            response: {
              stdout: 'Third answer',
              stderr: '',
              exitCode: 0,
              executionTime: 300,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:10:00.000Z'),
      }

      // Act
      const result = formatSessionHistory(sessionData)

      // Assert
      expect(result).toContain('## 1. User Request')
      expect(result).toContain('First question')
      expect(result).toContain('## 1. Agent Response')
      expect(result).toContain('First answer')

      expect(result).toContain('## 2. User Request')
      expect(result).toContain('Second question')
      expect(result).toContain('## 2. Agent Response')
      expect(result).toContain('Second answer')

      expect(result).toContain('## 3. User Request')
      expect(result).toContain('Third question')
      expect(result).toContain('## 3. Agent Response')
      expect(result).toContain('Third answer')
    })

    it('should handle empty history', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'empty-session',
        agentType: 'rule-advisor',
        history: [],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00.000Z'),
      }

      // Act
      const result = formatSessionHistory(sessionData)

      // Assert
      expect(result).toContain('# Session History: rule-advisor')
      expect(result).not.toContain('## 1')
    })

    it('should preserve multiline prompts and responses', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'multiline-session',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Line 1\nLine 2\nLine 3',
            },
            response: {
              stdout: 'Response line 1\nResponse line 2\nResponse line 3',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00.000Z'),
      }

      // Act
      const result = formatSessionHistory(sessionData)

      // Assert
      expect(result).toContain('Line 1\nLine 2\nLine 3')
      expect(result).toContain('Response line 1\nResponse line 2\nResponse line 3')
    })

    it('should not include metadata (sessionId, timestamp, cwd, exitCode, etc.)', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'metadata-test',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'Question',
              cwd: '/some/path',
            },
            response: {
              stdout: 'Answer',
              stderr: 'Some error',
              exitCode: 0,
              executionTime: 1234,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00.000Z'),
      }

      // Act
      const result = formatSessionHistory(sessionData)

      // Assert
      // Should NOT contain metadata
      expect(result).not.toContain('metadata-test')
      expect(result).not.toContain('2025-01-21T12:00:00.000Z')
      expect(result).not.toContain('/some/path')
      expect(result).not.toContain('Some error')
      expect(result).not.toContain('1234')
      expect(result).not.toContain('exitCode')

      // Should contain only essential conversation
      expect(result).toContain('Question')
      expect(result).toContain('Answer')
    })

    it('should be significantly shorter than JSON', () => {
      // Arrange
      const sessionData: SessionData = {
        sessionId: 'token-reduction-test',
        agentType: 'rule-advisor',
        history: [
          {
            timestamp: new Date('2025-01-21T12:00:00.000Z'),
            request: {
              agent: 'rule-advisor',
              prompt: 'This is a test prompt with some content',
              cwd: '/path/to/project',
            },
            response: {
              stdout: 'This is a test response with some content',
              stderr: '',
              exitCode: 0,
              executionTime: 1000,
            },
          },
        ],
        createdAt: new Date('2025-01-21T12:00:00.000Z'),
        lastUpdatedAt: new Date('2025-01-21T12:00:00.000Z'),
      }

      // Act
      const markdownFormat = formatSessionHistory(sessionData)
      const jsonFormat = JSON.stringify(sessionData)

      // Assert
      expect(markdownFormat.length).toBeLessThan(jsonFormat.length)

      // Calculate reduction rate
      const reductionRate = ((jsonFormat.length - markdownFormat.length) / jsonFormat.length) * 100

      // Should achieve at least 30% reduction
      expect(reductionRate).toBeGreaterThan(30)
    })
  })
})
