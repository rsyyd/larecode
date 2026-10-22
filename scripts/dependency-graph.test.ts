import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SPECIFIER = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.(?:ts|tsx)$/.test(entry) || /\.test\.(?:ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
}

function imports(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1]);
}

describe('package dependency graph', () => {
  it('resolves every relative import and reaches every source module', () => {
    const packages = join(ROOT, 'packages');
    const missing: string[] = [];
    const orphans: string[] = [];

    for (const name of readdirSync(packages)) {
      const src = join(packages, name, 'src');
      if (!existsSync(src)) continue;
      const files = sources(src);
      const edges = new Map<string, string[]>();

      for (const file of files) {
        const targets: string[] = [];
        for (const specifier of imports(file)) {
          const target = resolveImport(file, specifier);
          if (!target) {
            missing.push(`${relative(ROOT, file)} -> ${specifier}`);
            continue;
          }
          targets.push(target);
        }
        edges.set(file, targets);
      }

      const entry = join(src, 'index.ts');
      if (!existsSync(entry)) continue;
      const seen = new Set<string>();
      const queue = [entry];
      while (queue.length > 0) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        queue.push(...(edges.get(file) ?? []));
      }

      for (const file of files) {
        if (!seen.has(file)) orphans.push(relative(ROOT, file));
      }
    }

    expect(missing, 'relative imports that do not resolve').toEqual([]);
    expect(orphans, 'modules unreachable from a package entry point').toEqual([]);
  });
});
