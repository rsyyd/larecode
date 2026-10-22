import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const notices = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');

function runtimeDependencies(): string[] {
  const names = new Set<string>();
  for (const entry of readdirSync(join(ROOT, 'packages'))) {
    const file = join(ROOT, 'packages', entry, 'package.json');
    let manifest: { dependencies?: Record<string, string> };
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8')) as typeof manifest;
    } catch {
      continue;
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!name.startsWith('@larecode/')) names.add(name);
    }
  }
  return [...names].sort();
}

describe('third-party notices', () => {
  it('lists every direct runtime dependency with a license', () => {
    const missing = runtimeDependencies().filter(
      (name) => !notices.includes(`## ${name} `) || !notices.includes('- License: ')
    );
    expect(missing).toEqual([]);
  });
});
