import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { astGrepTool } from './astgrep.js';
import { Tools, type ToolContext } from './tool.js';
import { Permissions } from '../permission/permission.js';
import { Logger } from '../logger/logger.js';

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'lumps-astgrep-'));
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(
    join(project, 'src', 'one.ts'),
    `export function hello(name: string) {\n  return name;\n}\nconsole.log('trace');\n`
  );
  writeFileSync(join(project, 'src', 'two.js'), `function world() {\n  return 2;\n}\n`);
});

function registry(): Tools {
  const tools = new Tools({ logger: quiet() });
  tools.register(astGrepTool());
  return tools;
}

function ctx(): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: project,
    permissions: new Permissions(),
    abortSignal: new AbortController().signal,
  };
}

interface AstGrepOutput {
  matches: Array<{ file: string; line: number; text: string }>;
  count: number;
  truncated: boolean;
}

describe('ast_grep tool', () => {
  it('finds structural matches across languages', async () => {
    const result = await registry().execute(
      {
        id: 'c1',
        name: 'ast_grep',
        arguments: { pattern: 'function $NAME($$$ARGS) { $$$BODY }' },
      },
      ctx()
    );
    expect(result.success).toBe(true);
    const output = result.output as AstGrepOutput;
    expect(output.count).toBe(2);
    expect(output.matches.map((match) => `${match.file}:${match.line}`).sort()).toEqual([
      'src/one.ts:1',
      'src/two.js:1',
    ]);
  });

  it('scopes by language, path, and result cap', async () => {
    const byLang = await registry().execute(
      {
        id: 'c2',
        name: 'ast_grep',
        arguments: { pattern: 'function $NAME($$$ARGS) { $$$BODY }', lang: 'js' },
      },
      ctx()
    );
    expect((byLang.output as AstGrepOutput).matches.map((match) => match.file)).toEqual([
      'src/two.js',
    ]);

    const byPath = await registry().execute(
      { id: 'c3', name: 'ast_grep', arguments: { pattern: 'console.log($ARG)', path: 'src' } },
      ctx()
    );
    expect((byPath.output as AstGrepOutput).matches[0]).toMatchObject({
      file: 'src/one.ts',
      line: 4,
    });

    const capped = await registry().execute(
      {
        id: 'c4',
        name: 'ast_grep',
        arguments: { pattern: 'function $NAME($$$ARGS) { $$$BODY }', maxResults: 1 },
      },
      ctx()
    );
    expect((capped.output as AstGrepOutput).truncated).toBe(true);
  });

  it('rejects invalid patterns and inputs', async () => {
    const invalid = await registry().execute(
      { id: 'c5', name: 'ast_grep', arguments: { pattern: 'function {' } },
      ctx()
    );
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain('invalid pattern');

    const missing = await registry().execute({ id: 'c6', name: 'ast_grep', arguments: {} }, ctx());
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('requires a pattern');

    const badLang = await registry().execute(
      { id: 'c7', name: 'ast_grep', arguments: { pattern: 'function $N() {}', lang: 'rust' } },
      ctx()
    );
    expect(badLang.success).toBe(false);
    expect(badLang.error).toContain('unsupported lang');
  });
});
