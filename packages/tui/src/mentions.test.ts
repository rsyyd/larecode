import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverFiles, insertMention, matchFiles, mentionQuery } from './mentions.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'larecode-files-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'app.ts'), '');
  writeFileSync(join(dir, 'README.md'), '');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'app.test.ts'), '');
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'ignored.ts'), '');
  return dir;
}

describe('@ file mentions', () => {
  it('discovers files while skipping generated directories', () => {
    const files = discoverFiles(fixture());
    expect(files).toContain('app.ts');
    expect(files).toContain('src/app.test.ts');
    expect(files).not.toContain('node_modules/ignored.ts');
  });

  it('extracts the query at the cursor only', () => {
    expect(mentionQuery('read @app', 9)).toBe('app');
    expect(mentionQuery('read @app now', 13)).toBeNull();
    expect(mentionQuery('email a@b', 9)).toBeNull();
    expect(mentionQuery('@', 1)).toBe('');
  });

  it('ranks basename matches and limits the list', () => {
    const files = ['src/application.ts', 'app.ts', 'docs/app.md', 'other.ts'];
    expect(matchFiles(files, 'app', 2)).toEqual(['app.ts', 'docs/app.md']);
  });

  it('replaces the active mention and leaves the rest of the input', () => {
    expect(insertMention('read @ap now', 8, 'src/app.ts')).toEqual({
      text: 'read @src/app.ts  now',
      cursor: 17,
    });
  });
});
