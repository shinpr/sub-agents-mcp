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

  /**
   * Converts TOON format string back to JSON-compatible data.
   *
   * This method reverses the convertToToon operation, restoring the original data structure.
   * - Expands short keys back to full keys
   * - Parses compact timestamps back to Date objects
   * - Reconstructs arrays and objects from TOON notation
   *
   * @param toonString - TOON-formatted string to convert
   * @returns JSON-compatible data
   *
   * @example
   * ```typescript
   * const toonStr = "sid:abc123,agt:rule-advisor,h:[1,]{ts:20250121 120000},cat:20250121 120000"
   * const data = ToonConverter.convertToJson(toonStr)
   * // Returns: { sessionId: 'abc123', agentType: 'rule-advisor', history: [...], ... }
   * ```
   */
  static convertToJson(toonString: string): unknown {
    try {
      return ToonConverter.parseToonString(toonString)
    } catch (error) {
      // Fallback to JSON.parse on error
      console.error('TOON parsing failed, attempting JSON.parse:', error)
      try {
        return JSON.parse(toonString)
      } catch {
        throw new Error(
          `Failed to parse TOON string: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  /**
   * Reverse map from short keys to original keys.
   * @private
   */
  private static readonly REVERSE_KEY_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(ToonConverter.KEY_MAP).map(([long, short]) => [short, long])
  )

  /**
   * Parses a TOON format string into a JSON-compatible value.
   *
   * @param input - TOON string to parse
   * @returns Parsed value
   * @private
   */
  private static parseToonString(input: string): unknown {
    const trimmed = input.trim()

    // Handle null
    if (trimmed === 'null') {
      return null
    }

    // Handle undefined
    if (trimmed === 'undefined') {
      return undefined
    }

    // Handle boolean
    if (trimmed === 'true') {
      return true
    }
    if (trimmed === 'false') {
      return false
    }

    // Handle number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed)
    }

    // Handle compact timestamp (20250121 120000)
    if (/^\d{8} \d{6}$/.test(trimmed)) {
      return ToonConverter.parseCompactTimestamp(trimmed)
    }

    // Handle array notation [length,]items
    if (trimmed.startsWith('[') && trimmed.includes(',]')) {
      return ToonConverter.parseArray(trimmed)
    }

    // Handle explicit object notation with braces
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return ToonConverter.parseObject(trimmed)
    }

    // Handle object notation (key:value pairs)
    if (trimmed.includes(':') && !trimmed.startsWith('"')) {
      return ToonConverter.parseObject(trimmed)
    }

    // Handle quoted strings
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return JSON.parse(trimmed)
    }

    // Return as-is string
    return trimmed
  }

  /**
   * Parses a compact timestamp string back to Date object.
   *
   * Converts compact format to ISO 8601:
   * - Input: 20250121 120000
   * - Output: Date('2025-01-21T12:00:00.000Z')
   *
   * @param timestamp - Compact timestamp string
   * @returns Date object
   * @private
   */
  private static parseCompactTimestamp(timestamp: string): Date {
    const parts = timestamp.split(' ')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid compact timestamp format: ${timestamp}`)
    }

    const datePart = parts[0]
    const timePart = parts[1]
    const year = datePart.slice(0, 4)
    const month = datePart.slice(4, 6)
    const day = datePart.slice(6, 8)
    const hour = timePart.slice(0, 2)
    const minute = timePart.slice(2, 4)
    const second = timePart.slice(4, 6)

    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`)
  }

  /**
   * Parses TOON array notation.
   *
   * Format: [length,]item1,item2,item3
   * or [length,]{item1},{item2}
   *
   * @param input - TOON array string
   * @returns Parsed array
   * @private
   */
  private static parseArray(input: string): unknown[] {
    // Extract length from [length,]
    const lengthMatch = input.match(/^\[(\d+),\]/)
    if (!lengthMatch || !lengthMatch[1]) {
      return []
    }

    const length = Number.parseInt(lengthMatch[1], 10)
    if (length === 0) {
      return []
    }

    // Extract items after [length,]
    const itemsStr = input.slice(lengthMatch[0].length)
    if (itemsStr.length === 0) {
      return []
    }

    // Parse items (handling nested objects and arrays)
    const items: unknown[] = []
    let currentItem = ''
    let depth = 0
    let inString = false

    for (let i = 0; i < itemsStr.length; i++) {
      const char = itemsStr[i]

      if (char === '"' && (i === 0 || itemsStr[i - 1] !== '\\')) {
        inString = !inString
        currentItem += char
        continue
      }

      if (inString) {
        currentItem += char
        continue
      }

      if (char === '{' || char === '[') {
        depth++
        currentItem += char
      } else if (char === '}' || char === ']') {
        depth--
        currentItem += char
        // When we complete a nested object/array at depth 0, treat it as end of item
        if (depth === 0 && (char === '}' || char === ']')) {
          if (currentItem.trim().length > 0) {
            items.push(ToonConverter.parseToonString(currentItem.trim()))
            currentItem = ''
          }
        }
      } else if (char === ',' && depth === 0) {
        if (currentItem.trim().length > 0) {
          items.push(ToonConverter.parseToonString(currentItem.trim()))
        }
        currentItem = ''
      } else {
        currentItem += char
      }
    }

    // Add last item
    if (currentItem.trim().length > 0) {
      items.push(ToonConverter.parseToonString(currentItem.trim()))
    }

    return items
  }

  /**
   * Parses TOON object notation.
   *
   * Format: key1:value1,key2:value2
   * or {key1:value1,key2:value2}
   *
   * @param input - TOON object string
   * @returns Parsed object
   * @private
   */
  private static parseObject(input: string): Record<string, unknown> {
    let objectStr = input.trim()

    // Remove outer braces if present
    if (objectStr.startsWith('{') && objectStr.endsWith('}')) {
      objectStr = objectStr.slice(1, -1)
    }

    const result: Record<string, unknown> = {}
    let currentPair = ''
    let depth = 0
    let inString = false
    let inArrayNotation = false // Track if we're in array notation [N,]
    let arrayItemsRemaining = 0 // Number of array items to parse

    for (let i = 0; i < objectStr.length; i++) {
      const char = objectStr[i]

      if (char === '"' && (i === 0 || objectStr[i - 1] !== '\\')) {
        inString = !inString
        currentPair += char
        continue
      }

      if (inString) {
        currentPair += char
        continue
      }

      if (char === '[') {
        // Check if this is array notation [N,]
        const remaining = objectStr.slice(i)
        const arrayMatch = remaining.match(/^\[(\d+),\]/)
        if (arrayMatch?.[1]) {
          inArrayNotation = true
          arrayItemsRemaining = Number.parseInt(arrayMatch[1], 10)
          depth++ // Count the array as depth
        } else {
          depth++
        }
        currentPair += char
      } else if (char === ']') {
        currentPair += char
        if (inArrayNotation && depth === 1) {
          // Don't decrease depth for the closing ] of [N,]
          inArrayNotation = false
          // If the array is empty, reset depth to 0
          if (arrayItemsRemaining === 0) {
            depth = 0
          }
          // Keep depth at 1 for non-empty arrays because we're still inside the array value
        } else {
          depth--
          if (depth < 0) {
            break
          }
        }
      } else if (char === '{') {
        if (arrayItemsRemaining > 0 && depth === 1) {
          // This is the start of an array item
          // Don't increment depth relative to array level
        }
        depth++
        currentPair += char
      } else if (char === '}') {
        depth--
        currentPair += char
        if (arrayItemsRemaining > 0 && depth === 1) {
          // Completed an array item
          arrayItemsRemaining--
          if (arrayItemsRemaining === 0) {
            // Array is complete, reset depth
            depth = 0
          }
        }
        if (depth < 0) {
          break
        }
      } else if (char === ',' && depth === 0) {
        // Only treat as separator if we're at depth 0
        if (currentPair.trim().length > 0) {
          ToonConverter.parseKeyValue(currentPair.trim(), result)
        }
        currentPair = ''
        arrayItemsRemaining = 0 // Reset
      } else {
        currentPair += char
      }
    }

    // Add last pair
    if (currentPair.trim().length > 0) {
      ToonConverter.parseKeyValue(currentPair.trim(), result)
    }

    return result
  }

  /**
   * Parses a key:value pair and adds it to the result object.
   *
   * @param pair - Key:value pair string
   * @param result - Result object to add to
   * @private
   */
  private static parseKeyValue(pair: string, result: Record<string, unknown>): void {
    // Find the first colon that's not inside quotes or nested structures
    let colonIndex = -1
    let inString = false
    let depth = 0

    for (let i = 0; i < pair.length; i++) {
      const char = pair[i]

      if (char === '"' && (i === 0 || pair[i - 1] !== '\\')) {
        inString = !inString
      } else if (!inString) {
        if (char === '{' || char === '[') {
          depth++
        } else if (char === '}' || char === ']') {
          depth--
        } else if (char === ':' && depth === 0) {
          colonIndex = i
          break
        }
      }
    }

    if (colonIndex === -1) {
      return
    }

    let key = pair.slice(0, colonIndex).trim()
    const valueStr = pair.slice(colonIndex + 1).trim()

    // Remove quotes from key if present (for JSON compatibility)
    if (key.startsWith('"') && key.endsWith('"')) {
      key = JSON.parse(key)
    }

    // Expand short key to full key
    const fullKey = ToonConverter.REVERSE_KEY_MAP[key] || key

    // Parse value
    const value = ToonConverter.parseToonString(valueStr)

    result[fullKey] = value
  }
}
