import { describe, it, expect } from 'vitest';
import {
  LumpsError,
  isLumpsError,
  assertLumpsError,
  type ErrorCode,
  ERROR_CATEGORIES,
} from './error.js';

describe('Error taxonomy', () => {
  it('creates error with code, category, context, retryable', () => {
    const err = new LumpsError('PROVIDER_UNAVAILABLE', 'model down', {
      context: { model: 'gpt-4o' },
      retryable: true,
    });
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.category).toBe('provider');
    expect(err.retryable).toBe(true);
    expect(err.context.model).toBe('gpt-4o');
    expect(err.message).toBe('model down');
  });

  it('from() creates error with context', () => {
    const err = LumpsError.from('TOOL_NOT_FOUND', 'missing tool', { tool: 'bash' });
    expect(err.code).toBe('TOOL_NOT_FOUND');
    expect(err.context.tool).toBe('bash');
  });

  it('wrap() preserves cause', () => {
    const cause = new Error('network');
    const err = LumpsError.wrap('NETWORK_ERROR', cause, { endpoint: '/api' });
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.cause).toBe(cause);
    expect(err.context.endpoint).toBe('/api');
  });

  it('toJSON serializes correctly', () => {
    const err = new LumpsError('PERMISSION_DENIED', 'nope', { context: { group: 'shell' } });
    const json = err.toJSON();
    expect(json.code).toBe('PERMISSION_DENIED');
    expect(json.category).toBe('permission');
    expect(json.message).toBe('nope');
    expect(json.context.group).toBe('shell');
    expect(json.stack).toBeDefined();
  });

  it('isLumpsError type guard', () => {
    expect(isLumpsError(new LumpsError('UNKNOWN', 'x'))).toBe(true);
    expect(isLumpsError(new Error('x'))).toBe(false);
    expect(isLumpsError(null)).toBe(false);
  });

  it('assertLumpsError throws on non-LumpsError', () => {
    expect(() => assertLumpsError(new Error('x'))).toThrow(LumpsError);
    expect(() => assertLumpsError(new LumpsError('UNKNOWN', 'ok'))).not.toThrow();
  });

  it('all ErrorCode values have a category', () => {
    const codes: ErrorCode[] = [
      'UNKNOWN',
      'CONFIG_INVALID',
      'CONFIG_NOT_FOUND',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_AUTH_FAILED',
      'MODEL_NOT_FOUND',
      'TOOL_NOT_FOUND',
      'TOOL_EXECUTION_FAILED',
      'PERMISSION_DENIED',
      'SESSION_NOT_FOUND',
      'SESSION_CORRUPTED',
      'MEMORY_QUOTA_EXCEEDED',
      'CONTEXT_OVERFLOW',
      'MCP_CONNECTION_FAILED',
      'MCP_TOOL_FAILED',
      'LSP_UNAVAILABLE',
      'SKILL_LOAD_FAILED',
      'SKILL_EXECUTION_FAILED',
      'HOOK_EXECUTION_FAILED',
      'NETWORK_ERROR',
      'RATE_LIMITED',
      'BUDGET_EXCEEDED',
      'CANCELLED',
    ];
    for (const c of codes) {
      expect(ERROR_CATEGORIES[c]).toBeDefined();
    }
  });
});
