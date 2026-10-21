import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permissions } from '../permission/permission.js';
import type { ToolContext } from './tool.js';
import { astGrepTool, patternToRegex } from './astgrep.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lare-astgrep-'));
  writeFileSync(join(dir, 'a.ts'), 'console.log("hello");\nconst x = 1;\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    sessionId: 'astgrep-test',
    workingDir: dir,
    permissions: new Permissions({ mode: 'allow', allowedGroups: ['read'] }),
    abortSignal: new AbortController().signal,
  };
}

describe('ast_grep', () => {
  it('finds structural matches when ast-grep is available', async () => {
    const result = (await astGrepTool().execute(
      { pattern: 'console.log($ARG)', lang: 'ts' },
      ctx()
    )) as { matches: Array<{ file: string; line: number }>; count: number };
    expect(result.count).toBe(1);
    expect(result.matches[0]).toMatchObject({ file: 'a.ts', line: 1 });
  });

  it('falls back to text matching when ast-grep is unavailable', async () => {
    const result = (await astGrepTool({ load: async () => null }).execute(
      { pattern: 'console.log($ARG)', lang: 'ts' },
      ctx()
    )) as { matches: Array<{ file: string; line: number }>; fallback: boolean };
    expect(result.fallback).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ file: 'a.ts', line: 1 });
  });

  it('rejects unsupported languages', async () => {
    await expect(
      astGrepTool({ load: async () => null }).execute(
        { pattern: 'console.log($ARG)', lang: 'ruby' },
        ctx()
      )
    ).rejects.toThrow(/unsupported lang/);
  });

  it('turns metavariables into a safe regular expression', () => {
    expect(patternToRegex('console.log($ARG)').test('console.log("x")')).toBe(true);
    expect(patternToRegex('console.log($ARG)').test('console.logx("x")')).toBe(false);
  });
});
