import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.larecode']);

export function discoverFiles(root: string, limit = 500): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    if (files.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (files.length >= limit) return;
      if (SKIP.has(entry)) continue;
      const path = join(directory, entry);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(path);
      } else if (stats.isFile()) {
        files.push(relative(root, path).split('\\').join('/'));
      }
    }
  };
  walk(root);
  return files;
}

export function mentionQuery(text: string, cursor: number): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, cursor));
  return match ? (match[1] ?? '') : null;
}

export function matchFiles(files: string[], query: string, limit = 8): string[] {
  const needle = query.toLowerCase();
  const matches = files.filter((file) => file.toLowerCase().includes(needle));
  return matches
    .sort((a, b) => {
      const aName = a.split('/').pop() ?? a;
      const bName = b.split('/').pop() ?? b;
      const aStarts = aName.toLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = bName.toLowerCase().startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.length - b.length || a.localeCompare(b);
    })
    .slice(0, limit);
}

export function insertMention(
  text: string,
  cursor: number,
  path: string
): { text: string; cursor: number } {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf('@');
  if (start < 0) return { text, cursor };
  const value = `@${path} `;
  return {
    text: text.slice(0, start) + value + text.slice(cursor),
    cursor: start + value.length,
  };
}
