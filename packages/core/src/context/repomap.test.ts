import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRepoMap, extractFileFacts, pageRank, resolveImport } from './repomap.js';
import { estimateTokens } from '../usage/usage.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'lumps-repomap-'));
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(
    join(project, 'src', 'index.ts'),
    `import { aThing } from './a.js';\nimport { bThing } from './b.js';\nexport function main() {\n  return aThing() + bThing();\n}\n`
  );
  writeFileSync(
    join(project, 'src', 'a.ts'),
    `import { cHelper } from './c.js';\nexport class AThing {}\nexport const aThing = () => cHelper();\n`
  );
  writeFileSync(join(project, 'src', 'c.ts'), 'export function cHelper() {\n  return 1;\n}\n');
  writeFileSync(join(project, 'src', 'b.ts'), 'export function bThing() {\n  return 2;\n}\n');
  writeFileSync(join(project, 'src', 'z-standalone.ts'), 'export function lonely() {}\n');
});

describe('extractFileFacts', () => {
  it('extracts symbols, arrow consts, and imports', () => {
    const facts = extractFileFacts(
      `import { x } from './x.js';\nexport class Foo {}\nexport const bar = () => 1;\nexport interface Baz {}\n`,
      'src/sample.ts'
    );
    expect(facts.symbols.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual([
      'Foo:class',
      'bar:const',
      'Baz:interface',
    ]);
    expect(facts.imports).toEqual(['./x.js']);
  });

  it('resolves relative imports across extensions', () => {
    const files = new Set(['src/a.ts', 'src/b.tsx', 'src/dir/index.ts']);
    expect(resolveImport('src/main.ts', './a.js', files)).toBe('src/a.ts');
    expect(resolveImport('src/main.ts', './b', files)).toBe('src/b.tsx');
    expect(resolveImport('src/main.ts', './dir', files)).toBe('src/dir/index.ts');
    expect(resolveImport('src/main.ts', '@scope/pkg', files)).toBeUndefined();
  });
});

describe('pageRank', () => {
  it('ranks more-referenced files higher', () => {
    const edges = new Map<string, Set<string>>([
      ['src/index.ts', new Set(['src/a.ts', 'src/b.ts'])],
      ['src/a.ts', new Set(['src/c.ts'])],
      ['src/b.ts', new Set()],
      ['src/c.ts', new Set()],
      ['src/z.ts', new Set()],
    ]);
    const ranks = pageRank(['src/index.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/z.ts'], edges);
    expect(ranks.get('src/c.ts')).toBeGreaterThan(ranks.get('src/b.ts')!);
    expect(ranks.get('src/b.ts')).toBeGreaterThan(ranks.get('src/z.ts')!);
  });
});

describe('buildRepoMap', () => {
  it('renders ranked symbols within the token budget', async () => {
    const map = await buildRepoMap(project);
    expect(map).toContain('cHelper (function)');
    expect(map).toContain('main (function)');
    expect(map).toContain('AThing (class)');
    expect(map.indexOf('src/c.ts')).toBeLessThan(map.indexOf('src/b.ts'));
    expect(estimateTokens(map)).toBeLessThanOrEqual(1000);
  });

  it('truncates to the budget with a marker', async () => {
    const map = await buildRepoMap(project, { budgetTokens: 8 });
    expect(map).toContain('more files)');
    const lines = map.split('\n');
    expect(lines.length).toBe(2);
    expect(estimateTokens(lines[0])).toBeLessThanOrEqual(20);
  });
});
