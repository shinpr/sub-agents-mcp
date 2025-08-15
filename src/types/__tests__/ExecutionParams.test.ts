import type { ExecutionParams, ExecutionResult } from 'src/types/ExecutionParams'
import { describe, expect, it } from 'vitest'

describe('ExecutionParams', () => {
  it('should have required properties: agent, prompt and optional cwd, extra_args', () => {
    // This test will fail until we implement the ExecutionParams interface
    const executionParams: ExecutionParams = {
      agent: 'test-agent',
      prompt: 'Test prompt for execution',
    }

    expect(executionParams.agent).toBe('test-agent')
    expect(executionParams.prompt).toBe('Test prompt for execution')
    expect(executionParams.cwd).toBeUndefined()
    expect(executionParams.extra_args).toBeUndefined()
  })

  it('should support optional properties: cwd and extra_args', () => {
    const executionParams: ExecutionParams = {
      agent: 'test-agent',
      prompt: 'Test prompt',
      cwd: '/working/directory',
      extra_args: ['--verbose', '--debug'],
    }

    expect(executionParams.cwd).toBe('/working/directory')
    expect(executionParams.extra_args).toEqual(['--verbose', '--debug'])
  })

  it('should validate agent and prompt are non-empty strings', () => {
    const executionParams: ExecutionParams = {
      agent: 'valid-agent',
      prompt: 'Valid prompt',
    }

    expect(executionParams.agent.length).toBeGreaterThan(0)
    expect(executionParams.prompt.length).toBeGreaterThan(0)
  })
})

describe('ExecutionResult', () => {
  it('should have required properties: success, output and optional error', () => {
    // This test will fail until we implement the ExecutionResult interface
    const successResult: ExecutionResult = {
      success: true,
      output: 'Execution completed successfully',
    }

    expect(successResult.success).toBe(true)
    expect(successResult.output).toBe('Execution completed successfully')
    expect(successResult.error).toBeUndefined()
  })

  it('should support error property for failed executions', () => {
    const errorResult: ExecutionResult = {
      success: false,
      output: 'Execution failed',
      error: 'Agent not found',
    }

    expect(errorResult.success).toBe(false)
    expect(errorResult.output).toBe('Execution failed')
    expect(errorResult.error).toBe('Agent not found')
  })

  it('should have output as string', () => {
    const result: ExecutionResult = {
      success: true,
      output: 'Test output',
    }

    expect(typeof result.output).toBe('string')
  })
})
