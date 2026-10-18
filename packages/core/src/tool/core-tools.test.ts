import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Tools, type ToolContext, type ToolResult } from './tool.js';
import { coreTools } from './core.js';
import { globToRegExp, sha256 } from './files.js';
import { Logger } from '../logger/logger.js';
import { Permissions } from '../permission/permission.js';

let dir: string;
let tools: Tools;
let callId = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumps-tools-'));
  tools = new Tools({ logger: new Logger({ level: 'error', handlers: [() => {}] }) });
  for (const tool of coreTools()) tools.register(tool);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctx(abortSignal?: AbortSignal): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: dir,
    permissions: new Permissions(),
    abortSignal: abortSignal ?? new AbortController().signal,
  };
}

function call(name: string, args: unknown, context = ctx()): Promise<ToolResult> {
  return tools.execute({ id: `c${(callId += 1)}`, name, arguments: args }, context);
}

describe('core tool contract', () => {
  it('exposes eight registerable tools with valid schemas', () => {
    const all = coreTools();
    expect(all.map((tool) => tool.name).sort()).toEqual([
      'ast_grep',
      'bash',
      'edit',
      'glob',
      'grep',
      'patch',
      'read',
      'write',
    ]);
    for (const tool of all) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.schema.type).toBe('object');
      expect(typeof tool.schema.properties).toBe('object');
      expect(Array.isArray(tool.schema.required)).toBe(true);
      for (const required of tool.schema.required) {
        expect(tool.schema.properties[required]).toBeDefined();
      }
    }
    expect(tools.toToolSpecs()).toHaveLength(8);
  });

  it('rejects paths escaping the workspace', async () => {
    const result = await call('read', { path: '../outside.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('escapes workspace');

    const writeResult = await call('write', { path: '../evil.txt', content: 'x' });
    expect(writeResult.success).toBe(false);
  });
});

describe('read', () => {
  it('returns content, line metadata, and sha256', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    const result = await call('read', { path: 'a.txt' });
    expect(result.success).toBe(true);
    const out = result.output as { content: string; totalLines: number; sha256: string };
    expect(out.content).toBe('one\ntwo\nthree\n');
    expect(out.totalLines).toBe(3);
    expect(out.sha256).toBe(sha256('one\ntwo\nthree\n'));
  });

  it('supports offset and limit', async () => {
    await writeFile(join(dir, 'a.txt'), '1\n2\n3\n4\n');
    const result = await call('read', { path: 'a.txt', offset: 2, limit: 2 });
    const out = result.output as { content: string; offset: number; truncated: boolean };
    expect(out.content).toBe('2\n3');
    expect(out.offset).toBe(2);
    expect(out.truncated).toBe(true);
  });

  it('fails for a missing file', async () => {
    const result = await call('read', { path: 'missing.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('file not found');
  });
});

describe('write', () => {
  it('creates parent directories and reports hash and bytes', async () => {
    const result = await call('write', { path: 'nested/x.txt', content: 'hello' });
    expect(result.success).toBe(true);
    const out = result.output as { bytes: number; created: boolean; sha256: string };
    expect(out.created).toBe(true);
    expect(out.bytes).toBe(5);
    expect(out.sha256).toBe(sha256('hello'));
    expect(await readFile(join(dir, 'nested/x.txt'), 'utf8')).toBe('hello');
  });

  it('reports created=false when overwriting', async () => {
    await call('write', { path: 'x.txt', content: 'a' });
    const result = await call('write', { path: 'x.txt', content: 'b' });
    expect((result.output as { created: boolean }).created).toBe(false);
    expect(await readFile(join(dir, 'x.txt'), 'utf8')).toBe('b');
  });
});

describe('edit', () => {
  it('replaces a unique fragment and returns the new hash', async () => {
    await writeFile(join(dir, 'e.txt'), 'hello world');
    const result = await call('edit', { path: 'e.txt', oldString: 'world', newString: 'lumps' });
    expect(result.success).toBe(true);
    expect((result.output as { sha256: string }).sha256).toBe(sha256('hello lumps'));
    expect(await readFile(join(dir, 'e.txt'), 'utf8')).toBe('hello lumps');
  });

  it('fails when the fragment is missing', async () => {
    await writeFile(join(dir, 'e.txt'), 'abc');
    const result = await call('edit', { path: 'e.txt', oldString: 'zzz', newString: 'y' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('text not found');
  });

  it('fails on an ambiguous fragment without replaceAll', async () => {
    await writeFile(join(dir, 'e.txt'), 'x x');
    const result = await call('edit', { path: 'e.txt', oldString: 'x', newString: 'y' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not unique');
  });

  it('replaceAll rewrites every occurrence', async () => {
    await writeFile(join(dir, 'e.txt'), 'x x x');
    const result = await call('edit', {
      path: 'e.txt',
      oldString: 'x',
      newString: 'y',
      replaceAll: true,
    });
    expect((result.output as { replacements: number }).replacements).toBe(3);
    expect(await readFile(join(dir, 'e.txt'), 'utf8')).toBe('y y y');
  });
});

describe('bash', () => {
  it('captures stdout, stderr, and a non-zero exit code', async () => {
    const result = await call('bash', { command: 'echo out; echo err 1>&2; exit 3' });
    expect(result.success).toBe(true);
    const out = result.output as { stdout: string; stderr: string; exitCode: number };
    expect(out.stdout.trim()).toBe('out');
    expect(out.stderr.trim()).toBe('err');
    expect(out.exitCode).toBe(3);
  });

  it('runs in the workspace directory', async () => {
    await writeFile(join(dir, 'here.txt'), 'x');
    const result = await call('bash', { command: 'ls' });
    expect((result.output as { stdout: string }).stdout).toContain('here.txt');
  });

  it('kills the command on timeout', async () => {
    const result = await call('bash', { command: 'sleep 5', timeoutMs: 150 });
    const out = result.output as { timedOut: boolean; exitCode: number };
    expect(out.timedOut).toBe(true);
    expect(out.exitCode).toBe(-1);
  });

  it('reports cancellation when aborted mid-run', async () => {
    const controller = new AbortController();
    const promise = call('bash', { command: 'sleep 5' }, ctx(controller.signal));
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('CANCELLED');
  });
});

describe('glob', () => {
  it('matches recursively and skips heavy directories', async () => {
    await mkdir(join(dir, 'src/deep'), { recursive: true });
    await mkdir(join(dir, 'node_modules/pkg'), { recursive: true });
    await writeFile(join(dir, 'src/a.ts'), '');
    await writeFile(join(dir, 'src/deep/b.ts'), '');
    await writeFile(join(dir, 'node_modules/pkg/c.ts'), '');

    const result = await call('glob', { pattern: '**/*.ts' });
    expect(result.success).toBe(true);
    expect((result.output as { files: string[] }).files).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  it('scopes to a subdirectory and prefixes results', async () => {
    await mkdir(join(dir, 'src/deep'), { recursive: true });
    await writeFile(join(dir, 'src/a.ts'), '');
    await writeFile(join(dir, 'src/deep/b.ts'), '');

    const result = await call('glob', { pattern: '**/*.ts', path: 'src' });
    expect((result.output as { files: string[] }).files).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  it('caps results at the limit and flags truncation', async () => {
    await writeFile(join(dir, 'a.ts'), '');
    await writeFile(join(dir, 'b.ts'), '');
    await writeFile(join(dir, 'c.ts'), '');

    const result = await call('glob', { pattern: '*.ts', limit: 2 });
    const out = result.output as { files: string[]; truncated: boolean };
    expect(out.files).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });
});

describe('grep', () => {
  it('finds matches with file and line numbers', async () => {
    await writeFile(join(dir, 'x.ts'), 'alpha\nbeta\nalpha again\n');
    await writeFile(join(dir, 'y.md'), 'nothing here\n');

    const result = await call('grep', { pattern: 'alpha' });
    expect(result.success).toBe(true);
    const out = result.output as { matches: { file: string; line: number; text: string }[] };
    expect(out.matches).toHaveLength(2);
    expect(out.matches[0]).toEqual({ file: 'x.ts', line: 1, text: 'alpha' });
    expect(out.matches[1].line).toBe(3);
  });

  it('filters by include glob and supports ignoreCase', async () => {
    await writeFile(join(dir, 'x.ts'), 'Alpha\n');
    await writeFile(join(dir, 'y.md'), 'alpha\n');

    const scoped = await call('grep', { pattern: 'alpha', include: '**/*.md', ignoreCase: true });
    const matches = (scoped.output as { matches: { file: string }[] }).matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe('y.md');

    const caseSensitive = await call('grep', { pattern: 'Alpha' });
    expect((caseSensitive.output as { count: number }).count).toBe(1);
  });

  it('skips binary files', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 0x61, 0x6c, 0x70, 0x68, 0x61]));
    const result = await call('grep', { pattern: 'alpha' });
    expect((result.output as { count: number }).count).toBe(0);
  });

  it('honors maxResults', async () => {
    await writeFile(join(dir, 'm.txt'), 'a\na\na\n');
    const result = await call('grep', { pattern: 'a', maxResults: 2 });
    const out = result.output as { count: number; truncated: boolean };
    expect(out.count).toBe(2);
    expect(out.truncated).toBe(true);
  });

  it('rejects an invalid pattern', async () => {
    const result = await call('grep', { pattern: '([' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid pattern');
  });
});

describe('patch', () => {
  it('applies when the expected sha256 matches', async () => {
    await writeFile(join(dir, 'p.txt'), 'hello world');
    const result = await call('patch', {
      path: 'p.txt',
      sha256: sha256('hello world'),
      find: 'world',
      replace: 'lumps',
    });
    expect(result.success).toBe(true);
    expect((result.output as { sha256: string }).sha256).toBe(sha256('hello lumps'));
    expect(await readFile(join(dir, 'p.txt'), 'utf8')).toBe('hello lumps');
  });

  it('rejects with PATCH_CONFLICT when the file changed after hashing', async () => {
    await writeFile(join(dir, 'p.txt'), 'version 1');
    const stale = sha256('version 1');
    await writeFile(join(dir, 'p.txt'), 'version 2');

    const result = await call('patch', {
      path: 'p.txt',
      sha256: stale,
      find: 'version 2',
      replace: 'version 3',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('PATCH_CONFLICT');
    expect(await readFile(join(dir, 'p.txt'), 'utf8')).toBe('version 2');
  });

  it('flows from read: the returned sha256 is accepted by patch', async () => {
    await writeFile(join(dir, 'p.txt'), 'alpha beta');
    const read = await call('read', { path: 'p.txt' });
    const { sha256: hash } = read.output as { sha256: string };

    const result = await call('patch', {
      path: 'p.txt',
      sha256: hash,
      find: 'beta',
      replace: 'gamma',
    });
    expect(result.success).toBe(true);
    expect(await readFile(join(dir, 'p.txt'), 'utf8')).toBe('alpha gamma');
  });
});

describe('globToRegExp', () => {
  it('handles **, *, and ?', () => {
    expect(globToRegExp('**/*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('src/deep/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegExp('a?.ts').test('abc.ts')).toBe(false);
  });
});
