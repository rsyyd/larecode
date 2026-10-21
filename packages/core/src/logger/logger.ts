import { redactSecrets, redactValue } from '../permission/redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

export type LogHandler = (entry: LogEntry) => void;

function redactError(error: Error): Error {
  const clone = new Error(redactSecrets(error.message));
  clone.name = error.name;
  if (error.stack) clone.stack = redactSecrets(error.stack);
  return clone;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel = 'info';
  private handlers: LogHandler[] = [];

  constructor(options: { level?: LogLevel; handlers?: LogHandler[] } = {}) {
    if (options.level) this.level = options.level;
    if (options.handlers) this.handlers = options.handlers;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  addHandler(handler: LogHandler): void {
    this.handlers.push(handler);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) return;
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message: redactSecrets(message),
      ...(context ? { context: redactValue(context) as Record<string, unknown> } : {}),
      ...(error ? { error: redactError(error) } : {}),
    };
    for (const h of this.handlers) {
      try {
        h(entry);
      } catch {
        // swallow handler errors to avoid logging loops
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.emit('error', message, context, error);
  }

  child(context: Record<string, unknown>): Logger {
    const child = new Logger({ level: this.level, handlers: this.handlers });
    const originalEmit = child.emit.bind(child);
    child.emit = (level, message, ctx, err) => {
      originalEmit(level, message, { ...context, ...ctx }, err);
    };
    return child;
  }
}

export function createConsoleHandler(format: 'json' | 'pretty' = 'pretty'): LogHandler {
  return (entry) => {
    const ts = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const err = entry.error ? `\n  ${entry.error.stack ?? entry.error.message}` : '';
    if (format === 'json') {
      console.log(JSON.stringify({ ...entry, timestamp: ts }));
    } else {
      console.log(`${ts} ${level} ${entry.message}${ctx}${err}`);
    }
  };
}

export const defaultLogger = new Logger({
  level: (process.env.LARECODE_LOG_LEVEL as LogLevel) ?? 'info',
  handlers: [createConsoleHandler()],
});
