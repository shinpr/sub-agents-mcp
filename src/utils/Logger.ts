import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  error?: Error
}

export class Logger {
  private currentLevel: LogLevel
  private readonly logFilePath?: string
  private fileWriteErrorShown = false

  private static readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  constructor(level: LogLevel = 'info') {
    this.currentLevel = level

    const logFile = process.env['LOG_FILE']
    if (logFile?.trim()) {
      this.logFilePath = logFile.trim()
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorContext = error ? { ...context, error: error.message, stack: error.stack } : context
    this.log('error', message, errorContext)
  }

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

  private shouldLog(level: LogLevel): boolean {
    return Logger.levelPriority[level] >= Logger.levelPriority[this.currentLevel]
  }

  private output(entry: LogEntry): void {
    const { timestamp, level, message, context } = entry

    const formattedMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`

    if (context && Object.keys(context).length > 0) {
      console.error(formattedMessage, context)
    } else {
      console.error(formattedMessage)
    }

    if (this.logFilePath) {
      this.writeToFile(entry)
    }
  }

  private writeToFile(entry: LogEntry): void {
    this.performFileWrite(entry).catch((error: unknown) => {
      if (!this.fileWriteErrorShown) {
        this.fileWriteErrorShown = true
        console.error('Logger: Failed to write to log file, falling back to console only', error)
      }
    })
  }

  private async performFileWrite(entry: LogEntry): Promise<void> {
    if (!this.logFilePath) return

    const dir = dirname(this.logFilePath)
    await fs.mkdir(dir, { recursive: true })

    const jsonLine = `${JSON.stringify(entry)}\n`
    await fs.appendFile(this.logFilePath, jsonLine, 'utf8')
  }
}
