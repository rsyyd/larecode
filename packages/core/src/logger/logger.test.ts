import { describe, it, expect, beforeEach } from 'vitest';
import { Logger, createConsoleHandler, type LogEntry, type LogHandler } from './logger.js';

describe('Logger', () => {
  let logger: Logger;
  let captured: LogEntry[];

  beforeEach(() => {
    captured = [];
    const handler: LogHandler = (e) => captured.push(e);
    logger = new Logger({ level: 'debug', handlers: [handler] });
  });

  it('logs at or above configured level', () => {
    logger.setLevel('warn');
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    expect(captured.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('includes context and error in entry', () => {
    const err = new Error('boom');
    logger.error('fail', { key: 'value' }, err);
    expect(captured[0]).toMatchObject({
      level: 'error',
      message: 'fail',
      context: { key: 'value' },
      error: { message: 'boom' },
    });
  });

  it('redacts secrets in message, context, and error', () => {
    logger.error(
      'token sk-abcdef1234567890 leaked',
      { apiKey: 'ghp_abcdefghijklmnopqrstuvwx' },
      new Error('Bearer abcdefghijklmnop')
    );
    expect(captured[0].message).toBe('token [REDACTED] leaked');
    expect(captured[0].context).toEqual({ apiKey: '[REDACTED]' });
    expect(captured[0].error?.message).toBe('Bearer [REDACTED]');
  });

  it('child logger inherits level and handlers and merges context', () => {
    const child = logger.child({ requestId: 'abc' });
    child.info('hello');
    expect(captured[0].context).toEqual({ requestId: 'abc' });
  });

  it('createConsoleHandler pretty format works', () => {
    const entries: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => entries.push(args.join(' '));
    const handler = createConsoleHandler('pretty');
    handler({ timestamp: Date.now(), level: 'info', message: 'test', context: { a: 1 } });
    console.log = originalLog;
    expect(entries[0]).toContain('INFO');
    expect(entries[0]).toContain('test');
    expect(entries[0]).toContain('a');
  });

  it('createConsoleHandler json format works', () => {
    const entries: any[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => entries.push(JSON.parse(args[0]));
    const handler = createConsoleHandler('json');
    handler({ timestamp: 123, level: 'warn', message: 'x', context: { b: 2 } });
    console.log = originalLog;
    expect(entries[0].level).toBe('warn');
    expect(entries[0].context.b).toBe(2);
  });
});
