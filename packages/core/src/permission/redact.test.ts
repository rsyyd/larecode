import { describe, expect, it } from 'vitest';
import { redactSecrets, redactValue } from './redact.js';

describe('redactSecrets', () => {
  it('redacts known API key formats', () => {
    expect(redactSecrets('key sk-abcdef1234567890 done')).toBe('key [REDACTED] done');
    expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwx')).toBe('token [REDACTED]');
    expect(redactSecrets('aws AKIAIOSFODNN7EXAMPLE')).toBe('aws [REDACTED]');
    expect(redactSecrets('slack xoxb-1234567890-abcdef')).toBe('slack [REDACTED]');
  });

  it('redacts anthropic keys', () => {
    expect(redactSecrets('sk-ant-api03-abcdefghijklmnop')).toBe('[REDACTED]');
  });

  it('redacts bearer tokens', () => {
    const redacted = redactSecrets('Authorization: Bearer abcdefghijklmnop1234');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('abcdefghijklmnop1234');
  });

  it('redacts sensitive key-value pairs', () => {
    expect(redactSecrets('deploy --password hunter2secret')).toContain('[REDACTED]');
    expect(redactSecrets('api_key=abcdef123456')).toBe('api_key=[REDACTED]');
    expect(redactSecrets('token: xyzxyzxyzxyz')).toBe('token: [REDACTED]');
  });

  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const redacted = redactSecrets(`payload ${jwt}`);
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('run the tests in packages/core')).toBe('run the tests in packages/core');
  });
});

describe('redactValue', () => {
  it('redacts nested strings in objects and arrays', () => {
    const input = { cmd: ['deploy', 'token=supersecret123'], nested: { note: 'clean' } };
    const out = redactValue(input) as { cmd: string[]; nested: { note: string } };
    expect(out.cmd[1]).toBe('token=[REDACTED]');
    expect(out.nested.note).toBe('clean');
  });

  it('preserves non-string primitives', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(true)).toBe(true);
  });

  it('handles circular references', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const out = redactValue(obj) as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
  });
});
