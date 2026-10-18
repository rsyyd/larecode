import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { LumpsError } from '../error/error.js';

export const MAX_READ_BYTES = 1024 * 1024;
export const MAX_STREAM_BYTES = 1024 * 1024;
export const DEFAULT_GLOB_LIMIT = 1000;
export const DEFAULT_GREP_LIMIT = 200;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);

export function resolveInWorkspace(workingDir: string, input: string): string {
  const root = resolve(workingDir);
  const abs = resolve(root, input);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new LumpsError('TOOL_EXECUTION_FAILED', `path escapes workspace: ${input}`, {
      context: { workingDir: root, path: input },
    });
  }
  return abs;
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function globToRegExp(pattern: string): RegExp {
  const out: string[] = ['^'];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out.push('(?:.*/)?');
          i += 3;
          continue;
        }
        out.push('.*');
        i += 2;
        continue;
      }
      out.push('[^/]*');
      i += 1;
      continue;
    }
    if (c === '?') {
      out.push('[^/]');
      i += 1;
      continue;
    }
    if ('\\^$.|+()[]{}'.includes(c)) out.push('\\' + c);
    else out.push(c);
    i += 1;
  }
  out.push('$');
  return new RegExp(out.join(''));
}

export async function* walkFiles(root: string): AsyncGenerator<string> {
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    const dir = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(childRel);
      } else if (entry.isFile()) {
        yield childRel;
      }
    }
  }
}

export function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

export function applyReplacement(
  content: string,
  find: string,
  replace: string,
  replaceAll: boolean,
  displayPath: string
): { updated: string; replacements: number } {
  if (find === '') {
    throw new LumpsError('TOOL_EXECUTION_FAILED', 'find text must not be empty');
  }
  const occurrences = content.split(find).length - 1;
  if (occurrences === 0) {
    throw new LumpsError('TOOL_EXECUTION_FAILED', `text not found in ${displayPath}`, {
      context: { path: displayPath },
    });
  }
  if (occurrences > 1 && !replaceAll) {
    throw new LumpsError(
      'TOOL_EXECUTION_FAILED',
      `text is not unique in ${displayPath} (${occurrences} matches); pass more context or set replaceAll`,
      { context: { path: displayPath, occurrences } }
    );
  }
  return { updated: content.split(find).join(replace), replacements: occurrences };
}
