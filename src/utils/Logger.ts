import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Log level enumeration for structured logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Log entry structure for consistent logging format.
 */
export interface LogEntry {
  /** Timestamp of the log entry */
  timestamp: string
  /** Log level */
  level: LogLevel
  /** Log message */
  message: string
  /** Optional context data */
  context?: Record<string, unknown>
  /** Optional error object */
  error?: Error
}

/**
 * Logger interface for structured logging operations.
 */
export interface LoggerInterface {
  /**
   * Logs a debug message.
   *
   * @param message - The message to log
   * @param context - Optional context data
   */
  debug(message: string, context?: Record<string, unknown>): void

  /**
   * Logs an info message.
   *
   * @param message - The message to log
   * @param context - Optional context data
   */
  info(message: string, context?: Record<string, unknown>): void

  /**
   * Logs a warning message.
   *
   * @param message - The message to log
   * @param context - Optional context data
   */
  warn(message: string, context?: Record<string, unknown>): void

  /**
   * Logs an error message.
   *
   * @param message - The message to log
   * @param error - Optional error object
   * @param context - Optional context data
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void
}

/**
 * Logger utility class for structured logging.
 *
 * Provides consistent logging format with timestamps, levels, and context data.
 * Supports filtering by log level and structured output for debugging.
 */
export class Logger implements LoggerInterface {
  private currentLevel: LogLevel
  private readonly logFilePath?: string
  private fileWriteErrorShown = false

  /**
   * Log level priority for filtering.
   */
  private static readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  constructor(level: LogLevel = 'info') {
    this.currentLevel = level

    // Check for optional file logging via environment variable
    const logFile = process.env['LOG_FILE']
    if (logFile?.trim()) {
      this.logFilePath = logFile.trim()
    }
  }

  /**
   * Sets the current log level.
   *
   * @param level - The new log level
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level
  }

  /**
   * Gets the current log level.
   *
   * @returns The current log level
   */
  getLevel(): LogLevel {
    return this.currentLevel
  }

  /**
   * Logs a debug message.
   *
   * @param message - The message to log
   * @param context - Optional context data
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  /**
   * Logs an info message.
   *
   * @param message - The message to log
   * @param context - Optional context data
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  /**
   * Logs a warning message.
   *
   * @param message - The message to log
   * @param context - Optional context data
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  /**
   * Logs an error message.
   *
   * @param message - The message to log
   * @param error - Optional error object
   * @param context - Optional context data
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorContext = error ? { ...context, error: error.message, stack: error.stack } : context
    this.log('error', message, errorContext)
  }

  /**
   * Internal log method that handles the actual logging.
   *
   * @param level - The log level
   * @param message - The message to log
   * @param context - Optional context data
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return
    }

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
    }

    this.output(logEntry)
  }

  /**
   * Determines if a message should be logged based on current level.
   *
   * @param level - The log level to check
   * @returns True if the message should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return Logger.levelPriority[level] >= Logger.levelPriority[this.currentLevel]
  }

  /**
   * Outputs the log entry to the console and optionally to a file.
   *
   * @param entry - The log entry to output
   */
  private output(entry: LogEntry): void {
    const { timestamp, level, message, context } = entry

    // Format output for console readability
    const formattedMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`

    if (context && Object.keys(context).length > 0) {
      console.log(formattedMessage, context)
    } else {
      console.log(formattedMessage)
    }

    // Optional file output in JSON format
    if (this.logFilePath) {
      this.writeToFile(entry)
    }
  }

  /**
   * Writes log entry to file in JSON format.
   * Errors are handled internally and do not affect main logging flow.
   *
   * @param entry - The log entry to write to file
   */
  private writeToFile(entry: LogEntry): void {
    // Fire-and-forget async operation to avoid blocking main thread
    this.performFileWrite(entry).catch((error: unknown) => {
      // Only show file write error once to avoid spam
      if (!this.fileWriteErrorShown) {
        this.fileWriteErrorShown = true
        console.error('Logger: Failed to write to log file, falling back to console only', error)
      }
    })
  }

  /**
   * Performs the actual file write operation.
   *
   * @param entry - The log entry to write
   */
  private async performFileWrite(entry: LogEntry): Promise<void> {
    if (!this.logFilePath) return

    // Ensure directory exists
    const dir = dirname(this.logFilePath)
    await fs.mkdir(dir, { recursive: true })

    // Convert entry to JSON string
    const jsonLine = `${JSON.stringify(entry)}\n`

    // Append to file
    await fs.appendFile(this.logFilePath, jsonLine, 'utf8')
  }
}

/**
 * Creates a new Logger instance with the specified level.
 *
 * @param level - The log level for the new logger
 * @returns A new Logger instance
 */
export function createLogger(level: LogLevel = 'info'): Logger {
  return new Logger(level)
}
