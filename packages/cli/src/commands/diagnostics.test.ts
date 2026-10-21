import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debugCommand, feedbackCommand, usageCommand } from './diagnostics.js';

describe('diagnostics commands', () => {
  let home: string;
  const previous = process.env.LARECODE_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'larecode-cli-diag-'));
    process.env.LARECODE_HOME = home;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.LARECODE_HOME;
    else process.env.LARECODE_HOME = previous;
  });

  it('prints usage summary as JSON', () => {
    expect(usageCommand({ json: true })).toBe(0);
    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toMatchObject({ sessions: 0, tokens: 0 });
  });

  it('writes a debug bundle and reports its path', () => {
    expect(debugCommand({ json: true })).toBe(0);
    const output = JSON.parse(vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string) as {
      path: string;
    };
    expect(readFileSync(output.path, 'utf8')).toContain('"environment"');
  });

  it('rejects empty feedback and saves redacted feedback', () => {
    expect(feedbackCommand('   ')).toBe(1);
    expect(feedbackCommand('token=secret-value-abcdef', { json: true })).toBe(0);
    const output = JSON.parse(vi.mocked(process.stdout.write).mock.calls.at(-1)?.[0] as string) as {
      path: string;
    };
    expect(readFileSync(output.path, 'utf8')).not.toContain('secret-value-abcdef');
  });
});
