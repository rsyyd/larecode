import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { LareError } from '../error/error.js';

export const MAX_READ_BYTES = 1024 * 1024;
export const MAX_STREAM_BYTES = 1024 * 1024;
export const DEFAULT_GLOB_LIMIT = 1000;
export const DEFAULT_GREP_LIMIT = 200;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);

function realpathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function escapesRoot(root: string, abs: string): boolean {
  const realRoot = realpathOrUndefined(root) ?? root;
  let probe = abs;
  while (true) {
    const real = realpathOrUndefined(probe);
    if (real !== undefined) {
      return real !== realRoot && !real.startsWith(realRoot + sep);
    }
    const parent = dirname(probe);
    if (parent === probe) return true;
    probe = parent;
  }
}

export function resolveInWorkspace(workingDir: string, input: string): string {
  const root = resolve(workingDir);
  const abs = resolve(root, input);
  if (abs !== root && (!abs.startsWith(root + sep) || escapesRoot(root, abs))) {
    throw new LareError('TOOL_EXECUTION_FAILED', `path escapes workspace: ${input}`, {
      context: { workingDir: root, path: input },
    });
  }
  return abs;
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function writeFileAtomic(abs: string, content: string): Promise<void> {
  const temporary = join(
    dirname(abs),
    `.${basename(abs)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  let mode: number | undefined;
  try {
    mode = (await stat(abs)).mode;
  } catch {
    mode = undefined;
  }
  try {
    await writeFile(temporary, content, 'utf8');
    if (mode !== undefined) await chmod(temporary, mode & 0o7777);
    await rename(temporary, abs);
  } finally {
    await rm(temporary, { force: true });
  }
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

export async function readFilesConcurrent(
  root: string,
  files: string[],
  options: { maxBytes?: number; concurrency?: number } = {}
): Promise<Array<{ file: string; buf: Buffer }>> {
  const { maxBytes = Infinity, concurrency = 32 } = options;
  const out: Array<{ file: string; buf: Buffer }> = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, files.length)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= files.length) return;
        const file = files[index];
        try {
          const buf = await readFile(join(root, file));
          if (buf.length <= maxBytes) out.push({ file, buf });
        } catch {
          continue;
        }
      }
    }
  );
  await Promise.all(workers);
  return out;
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
    throw new LareError('TOOL_EXECUTION_FAILED', 'find text must not be empty');
  }
  const occurrences = content.split(find).length - 1;
  if (occurrences === 0 && content.includes('\r\n') && !find.includes('\r\n')) {
    const crlfOnly = !content.replace(/\r\n/g, '').includes('\n');
    if (crlfOnly) {
      const normalized = content.replace(/\r\n/g, '\n');
      const normalizedFind = find.replace(/\r\n/g, '\n');
      const normalizedReplace = replace.replace(/\r\n/g, '\n');
      const normalizedOccurrences = normalized.split(normalizedFind).length - 1;
      if (normalizedOccurrences > 0) {
        if (normalizedOccurrences > 1 && !replaceAll) {
          throw new LareError(
            'TOOL_EXECUTION_FAILED',
            `text is not unique in ${displayPath} (${normalizedOccurrences} matches); pass more context or set replaceAll`,
            { context: { path: displayPath, occurrences: normalizedOccurrences } }
          );
        }
        return {
          updated: normalized.split(normalizedFind).join(normalizedReplace).replace(/\n/g, '\r\n'),
          replacements: normalizedOccurrences,
        };
      }
    }
  }
  if (occurrences === 0) {
    throw new LareError('TOOL_EXECUTION_FAILED', `text not found in ${displayPath}`, {
      context: { path: displayPath },
    });
  }
  if (occurrences > 1 && !replaceAll) {
    throw new LareError(
      'TOOL_EXECUTION_FAILED',
      `text is not unique in ${displayPath} (${occurrences} matches); pass more context or set replaceAll`,
      { context: { path: displayPath, occurrences } }
    );
  }
  return { updated: content.split(find).join(replace), replacements: occurrences };
}
