import { describe, expect, it } from 'vitest'

describe('Hello World Test', () => {
  it('should return hello world', () => {
    const message = 'Hello World'
    expect(message).toBe('Hello World')
  })

  it('should concatenate strings correctly', () => {
    const hello = 'Hello'
    const world = 'World'
    expect(`${hello} ${world}`).toBe('Hello World')
  })
})
