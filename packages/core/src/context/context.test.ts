import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from './context.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'lare-context-'));
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(
    join(project, 'src', 'parser.ts'),
    'export function parseQuery(input) {\n  // parseQuery handles the query\n  return parseQueryNormalized(input);\n}\n'
  );
  writeFileSync(
    join(project, 'src', 'other.ts'),
    'export function unrelated() {\n  return null; // parseQuery appears once\n}\n'
  );
  writeFileSync(join(project, 'README.md'), '# docs\n');
});

describe('context engine', () => {
  it('indexes files and ranks hits with path boosts', async () => {
    const context = new Context();
    const count = await context.index(project);
    expect(count).toBe(3);

    const byTerm = await context.search({ query: 'parseQuery' });
    expect(byTerm.files[0].file).toBe('src/parser.ts');
    expect(byTerm.files[0].score).toBeGreaterThan(byTerm.files[1].score);

    const byPath = await context.search({ query: 'parser' });
    expect(byPath.files[0].file).toBe('src/parser.ts');
  });

  it('returns snippets with the matching line number', async () => {
    const context = new Context();
    await context.index(project);
    const result = await context.search({ query: 'unrelated' });
    expect(result.files[0]).toMatchObject({ file: 'src/other.ts', line: 1 });
    expect(result.files[0].snippet).toContain('unrelated');
  });

  it('keeps ranked hits inside the token budget', async () => {
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(
        join(project, 'src', `widget-${i}.ts`),
        `export const widget = ${i}; // widget helper ${i}\n`
      );
    }
    const context = new Context();
    await context.index(project);
    const result = await context.search({ query: 'widget', budgetTokens: 30 });
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.length).toBeLessThan(7);
    expect(result.budgetUsed).toBeLessThanOrEqual(30);
  });

  it('skips binary files and empty queries', async () => {
    writeFileSync(join(project, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const context = new Context();
    const count = await context.index(project);
    expect(count).toBe(3);
    expect((await context.search({ query: 'blob' })).files).toEqual([]);
    expect((await context.search({ query: '' })).files).toEqual([]);
  });
});
