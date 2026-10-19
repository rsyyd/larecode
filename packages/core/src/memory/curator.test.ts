import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Memory } from './memory.js';
import { MemoryCurator } from './curator.js';
import type { SessionMessage } from '../session/session.js';

let dir: string;
let projectDir: string;
let memory: Memory;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-curator-'));
  projectDir = await mkdtemp(join(tmpdir(), 'lare-project-'));
  memory = new Memory({ dir, projectDir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

function messages(...contents: string[]): SessionMessage[] {
  return contents.map((content, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content,
    timestamp: new Date(),
  }));
}

function curator(
  extract = vi.fn(async () => [{ key: 'stack', value: 'bun + typescript' }]),
  everyTurns = 2
) {
  return new MemoryCurator({ memory, extract, everyTurns });
}

describe('MemoryCurator', () => {
  it('reports due only on the configured cadence', () => {
    const c = curator();
    expect(c.due(0)).toBe(false);
    expect(c.due(1)).toBe(false);
    expect(c.due(2)).toBe(true);
    expect(c.due(3)).toBe(false);
    expect(c.due(4)).toBe(true);
  });

  it('skips extraction when not due', async () => {
    const extract = vi.fn(async () => [{ key: 'stack', value: 'bun' }]);
    const c = curator(extract, 3);
    expect(await c.maybeCurate(1, messages('hello'))).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('curates facts into the project tier when due', async () => {
    const c = curator();
    const entries = await c.maybeCurate(2, messages('we use bun', 'noted'));
    expect(entries).toHaveLength(1);
    expect(memory.get('project', 'stack')?.value).toBe('bun + typescript');
  });

  it('does not rewrite unchanged facts', async () => {
    const c = curator();
    await c.curate(messages('we use bun'));
    expect(await c.curate(messages('we use bun'))).toEqual([]);
  });

  it('updates facts whose value changed', async () => {
    const extract = vi
      .fn()
      .mockResolvedValueOnce([{ key: 'stack', value: 'bun' }])
      .mockResolvedValueOnce([{ key: 'stack', value: 'node' }]);
    const c = curator(extract);
    await c.curate(messages('first'));
    const entries = await c.curate(messages('second'));
    expect(entries).toHaveLength(1);
    expect(memory.get('project', 'stack')?.value).toBe('node');
  });

  it('can target the user tier and survives a reload', async () => {
    const c = new MemoryCurator({
      memory,
      extract: async () => [{ key: 'editor', value: 'neovim' }],
      tier: 'user',
    });
    await c.curate(messages('i use neovim'));
    const reloaded = new Memory({ dir, projectDir });
    expect(reloaded.get('user', 'editor')?.value).toBe('neovim');
    expect(reloaded.get('project', 'editor')).toBeUndefined();
  });
});
