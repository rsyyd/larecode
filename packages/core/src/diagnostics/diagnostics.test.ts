import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDebugBundle,
  formatUsage,
  summarizeUsage,
  writeCrashReport,
  writeDebugBundle,
  writeFeedback,
} from './diagnostics.js';

function metadata(overrides: Partial<Parameters<typeof summarizeUsage>[0][number]>) {
  return {
    id: 's1',
    createdAt: new Date(),
    updatedAt: new Date(),
    messageCount: 2,
    tokenUsage: 100,
    cost: 0.01,
    provider: '9router',
    model: 'test-model',
    ...overrides,
  };
}

describe('diagnostics', () => {
  let home: string;
  const previous = process.env.LARECODE_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'larecode-diag-'));
    process.env.LARECODE_HOME = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.LARECODE_HOME;
    else process.env.LARECODE_HOME = previous;
  });

  it('summarizes usage per session and model', () => {
    const summary = summarizeUsage([
      metadata({}),
      metadata({ id: 's2', tokenUsage: 50, cost: 0.02, model: 'other' }),
    ]);
    expect(summary).toMatchObject({ sessions: 2, messages: 4, tokens: 150 });
    expect(summary.byModel['9router/test-model']).toMatchObject({ sessions: 1, tokens: 100 });
    expect(summary.byModel['9router/other']).toMatchObject({ sessions: 1, tokens: 50 });
    expect(formatUsage(summary)).toContain('sessions: 2');
  });

  it('writes a redacted debug bundle', () => {
    process.env.LARECODE_TEST_KEY = 'sk-secret-value-1234567890';
    const bundle = createDebugBundle([metadata({})]);
    expect(bundle.sessions.sessions).toBe(1);
    expect(JSON.stringify(bundle.config)).not.toContain('sk-secret-value-1234567890');

    const path = writeDebugBundle();
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('"version"');
    expect(raw).not.toContain('sk-secret-value-1234567890');
  });

  it('writes a redacted crash report', () => {
    const path = writeCrashReport(new Error('failed with key sk-ant-secretvalue123456'));
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('[REDACTED]');
    expect(raw).not.toContain('sk-ant-secretvalue123456');
  });

  it('writes redacted feedback', () => {
    const path = writeFeedback('token=super-secret-token-value');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('super-secret-token-value');
    expect(raw).toContain('[REDACTED]');
  });
});
