import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, unknown>;
}

describe('release version', () => {
  it('keeps every package on the version reported by the CLI', () => {
    const source = readFileSync(join(ROOT, 'packages/core/src/version.ts'), 'utf8');
    const version = /VERSION = '([^']+)'/.exec(source)?.[1];
    expect(version).toBeTruthy();

    expect(readJson('package.json').version).toBe(version);
    expect(readJson('packages/cli/package.json').version).toBe(version);
    expect(readJson('npm/package.json').version).toBe(version);
  });

  it('ships the npm wrapper with a CLI entry point', () => {
    const pkg = readJson('npm/package.json');
    expect(pkg.name).toBe('larecode');
    expect(pkg.bin).toEqual({ larecode: 'bin/larecode.mjs' });
  });
});
