import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultLogger, type Logger } from '../logger/logger.js';

export interface LSPCapabilities {
  hover: boolean;
  definitions: boolean;
  references: boolean;
  symbols: boolean;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
}

export interface LSPOptions {
  command?: string;
  args?: string[];
  rootDir?: string;
  requestTimeoutMs?: number;
  logger?: Logger;
}

interface LSPRange {
  start: { line: number; character: number };
}

interface RPCError {
  code?: number;
  message?: string;
}

interface RPCMessage {
  jsonrpc?: string;
  id?: number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: RPCError;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const HOVER_MAX_CHARS = 2000;

const KIND_NAMES: Record<number, string> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'enumMember',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'typeParameter',
};

const LANGUAGE_IDS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.md': 'markdown',
  '.sh': 'shellscript',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
};

function contentsToText(contents: unknown): string | null {
  if (contents == null) return null;
  if (typeof contents === 'string') return contents.slice(0, HOVER_MAX_CHARS);
  if (Array.isArray(contents)) {
    const parts = contents
      .map((part) => contentsToText(part))
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join('\n').slice(0, HOVER_MAX_CHARS) : null;
  }
  if (typeof contents === 'object' && 'value' in contents) {
    const value = (contents as { value?: unknown }).value;
    return typeof value === 'string' ? value.slice(0, HOVER_MAX_CHARS) : null;
  }
  return null;
}

export class LSP {
  private readonly options: LSPOptions;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private child: ChildProcess | null = null;
  private pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private opened = new Set<string>();
  private nextId = 1;
  private attempted = false;
  private ready = false;
  private starting: Promise<void> | null = null;
  private unavailableReason: string | null = null;
  private caps: LSPCapabilities = {
    hover: false,
    definitions: false,
    references: false,
    symbols: false,
  };

  constructor(options: LSPOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? defaultLogger;
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  available(): boolean {
    return this.ready && this.child !== null;
  }

  reason(): string | null {
    return this.unavailableReason;
  }

  capabilities(): LSPCapabilities {
    return { ...this.caps };
  }

  async start(): Promise<void> {
    if (this.ready) return;
    if (this.starting) {
      await this.starting;
      return;
    }
    if (this.attempted) return;
    this.starting = this.doStart();
    await this.starting;
    this.starting = null;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child) {
      try {
        await this.request('shutdown', null, 1500);
      } catch {
        // ponytail: worst case the process is killed below
      }
      this.notify('exit', null);
    }
    this.child = null;
    this.ready = false;
    this.attempted = false;
    this.unavailableReason = null;
    this.opened.clear();
    child?.kill();
    this.settlePending('language server stopped');
  }

  async definitions(file: string, line: number, column = 1): Promise<SymbolInfo[]> {
    return this.lookup([], async () => {
      if (!this.caps.definitions) return [];
      const params = await this.positionParams(file, line, column);
      if (!params) return [];
      return this.locationsToSymbols(await this.request('textDocument/definition', params));
    });
  }

  async references(file: string, line: number, column = 1): Promise<SymbolInfo[]> {
    return this.lookup([], async () => {
      if (!this.caps.references) return [];
      const params = await this.positionParams(file, line, column);
      if (!params) return [];
      return this.locationsToSymbols(
        await this.request('textDocument/references', {
          ...params,
          context: { includeDeclaration: true },
        })
      );
    });
  }

  async symbols(file: string): Promise<SymbolInfo[]> {
    return this.lookup([], async () => {
      if (!this.caps.symbols) return [];
      const doc = await this.ensureOpen(file);
      if (!doc) return [];
      const result = await this.request('textDocument/documentSymbol', {
        textDocument: { uri: doc.uri },
      });
      return this.documentSymbols(result, doc.uri);
    });
  }

  async hover(file: string, line: number, column = 1): Promise<string | null> {
    return this.lookup(null, async () => {
      if (!this.caps.hover) return null;
      const params = await this.positionParams(file, line, column);
      if (!params) return null;
      const result = (await this.request('textDocument/hover', params)) as {
        contents?: unknown;
      } | null;
      return contentsToText(result?.contents ?? null);
    });
  }

  private async lookup<T>(fallback: T, run: () => Promise<T>): Promise<T> {
    await this.start();
    if (!this.available()) return fallback;
    try {
      return await run();
    } catch (error) {
      this.logger.warn('lsp query failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  private async doStart(): Promise<void> {
    this.attempted = true;
    const command = this.options.command;
    if (!command) {
      this.unavailableReason = 'no language server configured';
      return;
    }

    const cwd = resolve(this.options.rootDir ?? process.cwd());
    const child = spawn(command, this.options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    child.on('error', (error) => this.fail(`language server spawn failed: ${error.message}`));
    child.on('exit', () => {
      if (this.child === child) this.fail('language server exited');
    });

    const spawned = await new Promise<boolean>((settle) => {
      child.once('spawn', () => settle(true));
      child.once('error', () => settle(false));
    });
    if (!spawned) return;

    try {
      const result = (await this.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(cwd).href,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: {},
            references: {},
            documentSymbol: {},
          },
        },
      })) as { capabilities?: Record<string, unknown> } | null;
      this.notify('initialized', {});
      const serverCaps = result?.capabilities ?? {};
      this.caps = {
        hover: Boolean(serverCaps.hoverProvider),
        definitions: Boolean(serverCaps.definitionProvider),
        references: Boolean(serverCaps.referencesProvider),
        symbols: Boolean(serverCaps.documentSymbolProvider),
      };
      this.ready = true;
      this.logger.debug('lsp ready', { command, ...this.caps });
    } catch (error) {
      this.fail(
        `language server initialize failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private fail(reason: string): void {
    if (!this.unavailableReason) {
      this.unavailableReason = reason;
      this.logger.warn('lsp unavailable', { reason, command: this.options.command });
    }
    this.ready = false;
    const child = this.child;
    this.child = null;
    child?.kill();
    this.settlePending(reason);
  }

  private settlePending(reason: string): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    return new Promise((resolvePromise, rejectPromise) => {
      if (!this.child?.stdin) {
        rejectPromise(new Error('language server is not running'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(message: RPCMessage): void {
    const body = JSON.stringify(message);
    this.child?.stdin?.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      let message: RPCMessage;
      try {
        message = JSON.parse(body) as RPCMessage;
      } catch {
        this.logger.warn('lsp: dropped malformed message');
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: RPCMessage): void {
    const id = message.id;
    if (typeof id === 'number' && message.method === undefined) {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(message.error.message ?? 'language server error'));
      } else {
        request.resolve(message.result);
      }
      return;
    }
    if (typeof id === 'number' && message.method !== undefined) {
      this.write({ jsonrpc: '2.0', id, result: null });
    }
  }

  private async ensureOpen(file: string): Promise<{ uri: string } | null> {
    const abs = resolve(this.options.rootDir ?? process.cwd(), file);
    const uri = pathToFileURL(abs).href;
    if (this.opened.has(uri)) return { uri };
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      return null;
    }
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: LANGUAGE_IDS[extname(abs).toLowerCase()] ?? 'plaintext',
        version: 1,
        text,
      },
    });
    this.opened.add(uri);
    return { uri };
  }

  private async positionParams(
    file: string,
    line: number,
    column: number
  ): Promise<{
    textDocument: { uri: string };
    position: { line: number; character: number };
  } | null> {
    const doc = await this.ensureOpen(file);
    if (!doc) return null;
    return {
      textDocument: { uri: doc.uri },
      position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
    };
  }

  private locationsToSymbols(result: unknown): SymbolInfo[] {
    const items = Array.isArray(result) ? result : result ? [result] : [];
    const out: SymbolInfo[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as {
        uri?: string;
        targetUri?: string;
        range?: LSPRange;
        targetSelectionRange?: LSPRange;
        targetRange?: LSPRange;
      };
      const uri = record.uri ?? record.targetUri;
      const range = record.range ?? record.targetSelectionRange ?? record.targetRange;
      if (!uri || !range) continue;
      out.push({
        name: '',
        kind: 'location',
        file: this.displayPath(uri),
        line: range.start.line + 1,
        column: range.start.character + 1,
      });
    }
    return out;
  }

  private documentSymbols(result: unknown, fallbackUri: string): SymbolInfo[] {
    const items = Array.isArray(result) ? result : result ? [result] : [];
    const out: SymbolInfo[] = [];
    const walk = (node: unknown, file: string): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as {
        name?: string;
        kind?: number;
        range?: LSPRange;
        location?: { uri?: string; range?: LSPRange };
        children?: unknown[];
      };
      const uri = record.location?.uri ?? file;
      const range = record.range ?? record.location?.range;
      if (record.name && range) {
        out.push({
          name: record.name,
          kind: KIND_NAMES[record.kind ?? 0] ?? String(record.kind ?? 'unknown'),
          file: this.displayPath(uri),
          line: range.start.line + 1,
          column: range.start.character + 1,
        });
      }
      if (Array.isArray(record.children)) {
        for (const child of record.children) walk(child, uri);
      }
    };
    for (const item of items) walk(item, fallbackUri);
    return out;
  }

  private displayPath(uri: string): string {
    let abs: string;
    try {
      abs = fileURLToPath(uri);
    } catch {
      return uri;
    }
    const root = resolve(this.options.rootDir ?? process.cwd());
    const rel = relative(root, abs);
    return rel && !rel.startsWith('..') ? rel : abs;
  }
}
