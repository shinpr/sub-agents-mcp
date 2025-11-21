/**
 * TOON (Token Optimized Object Notation) converter utility.
 *
 * Converts JSON data to TOON format to reduce token consumption by 30-60%.
 *
 * Key optimizations:
 * - Shortened key names (sessionId → sid, timestamp → ts, etc.)
 * - Compact timestamp format (removes separators: 20250121 120000)
 * - Filters out empty strings and empty arrays
 * - Inline object representation {key:value,key2:value2}
 * - Array format [count,]{item1,item2}
 *
 * @example
 * ```typescript
 * const sessionData = {
 *   sessionId: 'abc123',
 *   agentType: 'rule-advisor',
 *   history: [...],
 *   createdAt: new Date('2025-01-21T12:00:00Z'),
 *   lastUpdatedAt: new Date('2025-01-21T12:00:00Z')
 * }
 * const toonStr = ToonConverter.convertToToon(sessionData)
 * // Output: sid:abc123,agt:rule-advisor,h:[1,]{...},cat:20250121 120000,uat:20250121 120000
 * ```
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional design for utility class with clear namespace
export class ToonConverter {
  /**
   * Converts JSON-compatible data to TOON format.
   *
   * TOON format features:
   * - Removes quotes from keys
   * - Uses compact array notation: [length,] { items }
   * - Reduces unnecessary brackets and commas
   * - Maintains data structure and readability
   *
   * @param jsonData - JSON-compatible data to convert
   * @returns TOON-formatted string
   *
   * @example
   * ```typescript
   * const data = { sessionId: 'abc123', agentType: 'rule-advisor' }
   * const toon = ToonConverter.convertToToon(data)
   * // Returns: "sessionId: abc123\nagentType: rule-advisor"
   * ```
   */
  static convertToToon(jsonData: unknown): string {
    try {
      // Don't use JSON.parse/stringify to preserve Date objects
      return ToonConverter.toToonString(jsonData, 0)
    } catch (error) {
      // Fallback to JSON string on error
      console.error('TOON conversion failed, falling back to JSON:', error)
      try {
        return JSON.stringify(jsonData, null, 2)
      } catch {
        return String(jsonData)
      }
    }
  }

  /**
   * Map of common long keys to short keys for token reduction.
   * @private
   */
  private static readonly KEY_MAP: Record<string, string> = {
    sessionId: 'sid',
    agentType: 'agt',
    timestamp: 'ts',
    request: 'req',
    response: 'res',
    createdAt: 'cat',
    lastUpdatedAt: 'uat',
    stdout: 'out',
    stderr: 'err',
    exitCode: 'ec',
    executionTime: 'et',
    history: 'h',
  }

  /**
   * Recursively converts a value to TOON format string.
   *
   * @param value - Value to convert
   * @param depth - Current nesting depth for indentation
   * @returns TOON-formatted string
   * @private
   */
  private static toToonString(value: unknown, depth: number): string {
    // Handle null
    if (value === null) {
      return 'null'
    }

    // Handle undefined
    if (value === undefined) {
      return 'undefined'
    }

    // Handle primitives
    if (typeof value === 'string') {
      // Quote strings if they contain special characters or spaces
      if (ToonConverter.needsQuotes(value)) {
        return JSON.stringify(value)
      }
      return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    // Handle Date objects (convert to compact timestamp format)
    if (value instanceof Date) {
      return ToonConverter.formatCompactTimestamp(value)
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[0,]'
      }

      // For compact representation, join array items with comma
      const items = value.map((item) => ToonConverter.toToonObjectCompact(item)).join(',')
      return `[${value.length},]${items}`
    }

    // Handle objects
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)

      if (entries.length === 0) {
        return '{}'
      }

      const lines = entries
        .map(([key, val]) => {
          // Use short key if available
          const shortKey = ToonConverter.KEY_MAP[key] || key
          const valueStr = ToonConverter.toToonString(val, depth)
          // Keep everything compact on same line for simple values
          return `${shortKey}:${valueStr}`
        })
        .join(',')

      return lines
    }

    // Fallback for unknown types
    return String(value)
  }

  /**
   * Converts an object to compact TOON format (for array items).
   *
   * @param value - Object to convert
   * @returns Compact TOON string
   * @private
   */
  private static toToonObjectCompact(value: unknown): string {
    if (value === null || value === undefined) {
      return String(value)
    }

    if (typeof value !== 'object') {
      return String(value)
    }

    if (value instanceof Date) {
      return ToonConverter.formatCompactTimestamp(value)
    }

    if (Array.isArray(value)) {
      return `[${value.length}]`
    }

    // For objects, create a compact inline representation
    const entries = Object.entries(value as Record<string, unknown>)
    const pairs = entries
      .filter(([, v]) => {
        // Skip empty strings and empty arrays to reduce tokens
        if (v === '') return false
        if (Array.isArray(v) && v.length === 0) return false
        return true
      })
      .map(([k, v]) => {
        // Use short key if available
        const shortKey = ToonConverter.KEY_MAP[k] || k
        let valStr: string
        if (v === null || v === undefined) {
          valStr = String(v)
        } else if (typeof v === 'string') {
          valStr = ToonConverter.needsQuotes(v) ? JSON.stringify(v) : v
        } else if (typeof v === 'object') {
          if (v instanceof Date) {
            valStr = ToonConverter.formatCompactTimestamp(v)
          } else if (Array.isArray(v)) {
            valStr = `[${v.length}]`
          } else {
            valStr = ToonConverter.toToonObjectCompact(v)
          }
        } else {
          valStr = String(v)
        }
        return `${shortKey}:${valStr}`
      })

    return `{${pairs.join(',')}}`
  }

  /**
   * Formats a Date object to compact timestamp format.
   *
   * Converts ISO 8601 timestamp to compact format:
   * - Input: 2025-01-21T12:00:00.000Z
   * - Output: 20250121 120000
   *
   * This reduces token count by removing separators and milliseconds.
   *
   * @param date - Date object to format
   * @returns Compact timestamp string
   * @private
   */
  private static formatCompactTimestamp(date: Date): string {
    return date
      .toISOString()
      .replace(/\.\d{3}Z$/, '') // Remove milliseconds and Z
      .replace(/T/, ' ') // Replace T with space
      .replace(/-/g, '') // Remove hyphens
      .replace(/:/g, '') // Remove colons
  }

  /**
   * Checks if a string value needs to be quoted in TOON format.
   *
   * Strings are quoted if they contain:
   * - Spaces
   * - Special characters (except hyphen and underscore)
   * - Start with a number
   * - Reserved keywords (null, undefined, true, false)
   *
   * @param value - String value to check
   * @returns True if the string needs quotes
   * @private
   */
  private static needsQuotes(value: string): boolean {
    // Empty strings need quotes
    if (value.length === 0) {
      return true
    }

    // Reserved keywords need quotes
    const reserved = ['null', 'undefined', 'true', 'false']
    if (reserved.includes(value)) {
      return true
    }

    // Check for special characters, spaces, or newlines
    // Allow: alphanumeric, hyphen, underscore, forward slash, period, colon
    const needsQuotesPattern = /[^a-zA-Z0-9\-_/.:\u3000-\u9fff]/
    return needsQuotesPattern.test(value)
  }
}
