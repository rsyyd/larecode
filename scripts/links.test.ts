import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const FILES = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md'];

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') return [];
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return entry.endsWith('.md') ? [path] : [];
  });
}

function localTargets(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const targets: string[] = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (!target || /^(?:https?:|mailto:|#|\/)/.test(target)) continue;
    const path = target.split('#')[0]?.split('?')[0];
    if (path) targets.push(decodeURIComponent(path));
  }
  return targets;
}

describe('documentation links', () => {
  it('resolves every relative link to a file in the repository', () => {
    const files = [...FILES.map((file) => join(ROOT, file)), ...markdownFiles(join(ROOT, 'docs'))];
    const missing = files.flatMap((file) =>
      localTargets(file)
        .filter((target) => !existsSync(resolve(dirname(file), target)))
        .map((target) => `${file}: ${target}`)
    );

    expect(missing).toEqual([]);
  });
});
