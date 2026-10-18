import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LSP } from './lsp.js';
import { lspTool } from '../tool/lsp.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Logger } from '../logger/logger.js';
import { Permissions } from '../permission/permission.js';

const FAKE_SERVER = `
const { stdin, stdout } = process;
let buffer = Buffer.alloc(0);
const opened = new Set();
function send(message) {
  const body = JSON.stringify(message);
  stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
}
function handle(message) {
  if (message.id !== undefined && message.method) {
    let result = null;
    switch (message.method) {
      case 'initialize':
        result = {
          capabilities: {
            definitionProvider: true,
            referencesProvider: true,
            documentSymbolProvider: true,
            hoverProvider: true,
          },
        };
        break;
      case 'shutdown':
        break;
      case 'textDocument/documentSymbol': {
        const uri = message.params.textDocument.uri;
        result = opened.has(uri)
          ? [
              {
                name: 'greet',
                kind: 12,
                range: { start: { line: 2, character: 0 }, end: { line: 4, character: 1 } },
                children: [
                  {
                    name: 'inner',
                    kind: 13,
                    range: { start: { line: 3, character: 2 }, end: { line: 3, character: 7 } },
                  },
                ],
              },
            ]
          : null;
        break;
      }
      case 'textDocument/definition':
        result = [
          {
            uri: message.params.textDocument.uri,
            range: { start: { line: 4, character: 4 }, end: { line: 4, character: 9 } },
          },
        ];
        break;
      case 'textDocument/references':
        result = [
          {
            uri: message.params.textDocument.uri,
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
          },
          {
            uri: 'file:///outside/other.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
          },
        ];
        break;
      case 'textDocument/hover':
        result = { contents: { kind: 'markdown', value: '\\u0060\\u0060\\u0060ts\\nfunction greet(): string\\n\\u0060\\u0060\\u0060' } };
        break;
      default:
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } });
        return;
    }
    send({ jsonrpc: '2.0', id: message.id, result });
    return;
  }
  if (message.method === 'textDocument/didOpen') opened.add(message.params.textDocument.uri);
  if (message.method === 'exit') process.exit(0);
}
stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    handle(JSON.parse(body));
  }
});
`;

let dir: string;
let lsp: LSP;

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

function ctx(): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: dir,
    permissions: new Permissions(),
    abortSignal: new AbortController().signal,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumps-lsp-'));
  await writeFile(join(dir, 'server.cjs'), FAKE_SERVER);
  await writeFile(join(dir, 'sample.ts'), 'export function greet(): string {\n  return "hi";\n}\n');
  lsp = new LSP({
    command: process.execPath,
    args: [join(dir, 'server.cjs')],
    rootDir: dir,
    logger: quiet(),
  });
});

afterEach(async () => {
  await lsp.stop();
  await rm(dir, { recursive: true, force: true });
});

describe('lsp client', () => {
  it('starts on demand, initializes, and reports capabilities', async () => {
    expect(lsp.available()).toBe(false);
    await lsp.start();
    expect(lsp.available()).toBe(true);
    expect(lsp.capabilities()).toEqual({
      hover: true,
      definitions: true,
      references: true,
      symbols: true,
    });
  });

  it('returns document symbols with nested children at 1-based positions', async () => {
    const symbols = await lsp.symbols('sample.ts');
    expect(symbols).toEqual([
      { name: 'greet', kind: 'function', file: 'sample.ts', line: 3, column: 1 },
      { name: 'inner', kind: 'variable', file: 'sample.ts', line: 4, column: 3 },
    ]);
  });

  it('resolves definitions to workspace-relative locations', async () => {
    const defs = await lsp.definitions('sample.ts', 1, 1);
    expect(defs).toEqual([{ name: '', kind: 'location', file: 'sample.ts', line: 5, column: 5 }]);
  });

  it('keeps references outside the workspace as absolute paths', async () => {
    const refs = await lsp.references('sample.ts', 1, 1);
    expect(refs.map((ref) => ref.file)).toEqual(['sample.ts', '/outside/other.ts']);
    expect(refs[0]?.line).toBe(2);
  });

  it('normalizes hover contents to text', async () => {
    const hover = await lsp.hover('sample.ts', 1, 1);
    expect(hover).toContain('function greet(): string');
  });

  it('degrades gracefully when the server cannot start', async () => {
    const broken = new LSP({
      command: 'lumps-missing-language-server-xyz',
      rootDir: dir,
      logger: quiet(),
    });
    await broken.start();
    expect(broken.available()).toBe(false);
    expect(broken.reason()).toContain('spawn failed');
    expect(await broken.symbols('sample.ts')).toEqual([]);
    expect(await broken.hover('sample.ts', 1, 1)).toBeNull();
    await broken.stop();
  });

  it('reports a reason when no server is configured', async () => {
    const none = new LSP({ rootDir: dir, logger: quiet() });
    expect(await none.symbols('sample.ts')).toEqual([]);
    expect(none.available()).toBe(false);
    expect(none.reason()).toContain('no language server configured');
  });
});

describe('lsp tool', () => {
  it('formats symbol and hover results for the model', async () => {
    const tools = new Tools({ logger: quiet() });
    tools.register(lspTool(lsp));

    const symbols = await tools.execute(
      { id: 'c1', name: 'lsp', arguments: { action: 'symbols', path: 'sample.ts' } },
      ctx()
    );
    expect(symbols.success).toBe(true);
    expect((symbols.output as { results: string[] }).results).toEqual([
      'sample.ts:3:1 function greet',
      'sample.ts:4:3 variable inner',
    ]);

    const hover = await tools.execute(
      { id: 'c2', name: 'lsp', arguments: { action: 'hover', path: 'sample.ts', line: 1 } },
      ctx()
    );
    expect((hover.output as { results: string[] }).results[0]).toContain('function greet');
  });

  it('rejects position actions without a line', async () => {
    const tools = new Tools({ logger: quiet() });
    tools.register(lspTool(lsp));
    const result = await tools.execute(
      { id: 'c3', name: 'lsp', arguments: { action: 'definition', path: 'sample.ts' } },
      ctx()
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires a line');
  });

  it('reports unavailability instead of failing', async () => {
    const tools = new Tools({ logger: quiet() });
    tools.register(lspTool(new LSP({ rootDir: dir, logger: quiet() })));
    const result = await tools.execute(
      { id: 'c4', name: 'lsp', arguments: { action: 'symbols', path: 'sample.ts' } },
      ctx()
    );
    expect(result.success).toBe(true);
    const output = result.output as { unavailable?: boolean; reason?: string };
    expect(output.unavailable).toBe(true);
    expect(output.reason).toContain('no language server configured');
  });
});
