/**
 * @agentbridge/interfaces - Logger Interface
 * Logging interface for debugging and monitoring
 */

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry
 */
export interface LogEntry {
  /** Timestamp in ms */
  timestamp: number;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Error object if applicable */
  error?: Error;
  /** Source module/component */
  module?: string;
}

/**
 * Log handler function
 */
export type LogHandler = (entry: LogEntry) => void;

/**
 * ILogger - Logging interface
 *
 * Implementations can use:
 * - Console (default)
 * - Pino (Node.js)
 * - Winston (Node.js)
 * - CloudWatch (AWS)
 * - Custom
 */
export interface ILogger {
  /**
   * Get current log level
   */
  getLevel(): LogLevel;

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void;

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void;

  /**
   * Create child logger with module context
   */
  child(module: string): ILogger;

  /**
   * Add log handler
   */
  addHandler(handler: LogHandler): void;

  /**
   * Remove log handler
   */
  removeHandler(handler: LogHandler): void;
}

/**
 * Logger options
 */
export interface LoggerOptions {
  /** Log level */
  level?: LogLevel;
  /** Module name */
  module?: string;
  /** Include timestamp */
  timestamp?: boolean;
  /** Include context */
  context?: Record<string, unknown>;
}

/**
 * Logger factory function type
 */
export type LoggerFactory = (options?: LoggerOptions) => ILogger;

const loggerFactories = new Map<string, LoggerFactory>();

/**
 * Register a logger factory
 */
export function registerLoggerFactory(type: string, factory: LoggerFactory): void {
  loggerFactories.set(type, factory);
}

/**
 * Create a logger instance
 */
export function createLogger(options?: LoggerOptions, type = 'console'): ILogger {
  const factory = loggerFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown logger type: ${type}. Available: ${getRegisteredLoggerTypes().join(', ')}`);
  }
  return factory(options);
}

/**
 * Get list of registered logger types
 */
export function getRegisteredLoggerTypes(): string[] {
  return Array.from(loggerFactories.keys());
}

/**
 * Console logger implementation (default)
 */
export class ConsoleLogger implements ILogger {
  private level: LogLevel = 'info';
  private module?: string;
  private handlers: LogHandler[] = [];

  constructor(options?: LoggerOptions) {
    if (options?.level) this.level = options.level;
    if (options?.module) this.module = options.module;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
      error,
      module: this.module,
    };

    // Console output
    const prefix = `[${level.toUpperCase()}]${this.module ? ` [${this.module}]` : ''}`;
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';

    switch (level) {
      case 'debug':
        console.debug(prefix, message, contextStr);
        break;
      case 'info':
        console.info(prefix, message, contextStr);
        break;
      case 'warn':
        console.warn(prefix, message, contextStr);
        break;
      case 'error':
        console.error(prefix, message, contextStr, error || '');
        break;
    }

    // Call handlers
    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch {
        // Ignore handler errors
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('error', message, context, error);
  }

  child(module: string): ILogger {
    return new ConsoleLogger({
      level: this.level,
      module: this.module ? `${this.module}:${module}` : module,
    });
  }

  addHandler(handler: LogHandler): void {
    this.handlers.push(handler);
  }

  removeHandler(handler: LogHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index !== -1) {
      this.handlers.splice(index, 1);
    }
  }
}

// Register default console logger
registerLoggerFactory('console', (options) => new ConsoleLogger(options));
