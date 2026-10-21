import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permissions } from '../permission/permission.js';
import type { ToolContext } from './tool.js';
import { applyReplacement, sha256 } from './files.js';
import { patchTool } from './patch.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lare-patch-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function ctx(workingDir = dir): ToolContext {
  return {
    sessionId: 'patch-test',
    workingDir,
    permissions: new Permissions({ mode: 'allow', allowedGroups: ['write'] }),
    abortSignal: new AbortController().signal,
  };
}

describe('patch', () => {
  it('applies a change when the hash matches', async () => {
    const file = join(dir, 'a.txt');
    const content = 'hello world\n';
    writeFileSync(file, content);
    const result = (await patchTool().execute(
      { path: 'a.txt', sha256: sha256(content), find: 'world', replace: 'lare' },
      ctx()
    )) as { replacements: number };

    expect(result.replacements).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('hello lare\n');
  });

  it('rejects stale content with PATCH_CONFLICT', async () => {
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'new content');
    await expect(
      patchTool().execute(
        { path: 'a.txt', sha256: sha256('old content'), find: 'new', replace: 'x' },
        ctx()
      )
    ).rejects.toMatchObject({ code: 'PATCH_CONFLICT' });
  });

  it('matches LF patches against a CRLF file and preserves CRLF', async () => {
    const file = join(dir, 'crlf.txt');
    const content = 'first\r\nsecond\r\nthird\r\n';
    writeFileSync(file, content);
    await patchTool().execute(
      { path: 'crlf.txt', sha256: sha256(content), find: 'first\nsecond', replace: 'first\nchanged' },
      ctx()
    );
    expect(readFileSync(file, 'utf8')).toBe('first\r\nchanged\r\nthird\r\n');
  });

  it('rejects ambiguous matches unless replaceAll is set', async () => {
    const file = join(dir, 'dup.txt');
    const content = 'same\nsame\nsame\n';
    writeFileSync(file, content);
    const tool = patchTool();
    await expect(
      tool.execute(
        { path: 'dup.txt', sha256: sha256(content), find: 'same', replace: 'new' },
        ctx()
      )
    ).rejects.toThrow(/not unique/);

    await tool.execute(
      {
        path: 'dup.txt',
        sha256: sha256(content),
        find: 'same',
        replace: 'new',
        replaceAll: true,
      },
      ctx()
    );
    expect(readFileSync(file, 'utf8')).toBe('new\nnew\nnew\n');
  });

  it('survives randomized exact replacements', () => {
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 0x100000000;
      return seed / 0x100000000;
    };
    for (let i = 0; i < 200; i += 1) {
      const pieces = Array.from({ length: 4 }, (_, index) => `token-${i}-${index}`);
      const content = `${pieces.join('\n')}\n`;
      const find = pieces[Math.floor(random() * pieces.length)];
      const replace = `replacement-${i}`;
      const result = applyReplacement(content, find, replace, false, 'fuzz.txt');
      expect(result.replacements).toBe(1);
      expect(result.updated).toContain(replace);
      expect(result.updated.split(find)).toHaveLength(1);
    }
  });
});
