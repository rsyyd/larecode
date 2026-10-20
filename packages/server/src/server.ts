import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  AgentRuntimeLoop,
  Sessions,
  VERSION,
  loadEffectiveConfig,
  type HaltReason,
} from '@larecode/core';
import { Shares, renderSharePage } from './share.js';

export const DEFAULT_SERVER_PORT = 4096;
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export type ServerScope = 'read' | 'write' | 'run';

export interface ServerToken {
  name: string;
  token: string;
  scopes: ServerScope[];
}

export interface TurnResult {
  halt: HaltReason | null;
  tokens: number;
  cost: number;
}

export interface TurnContext {
  sessionId: string;
  signal: AbortSignal;
}

export type TurnHandler = (
  prompt: string,
  context: TurnContext
) => AsyncGenerator<string, TurnResult>;

export interface ServerOptions {
  port?: number;
  host?: string;
  token?: string;
  tokens?: ServerToken[];
  sessions?: Sessions;
  shares?: Shares;
  workingDir?: string;
  provider?: string;
  model?: string;
  runTurn?: TurnHandler;
  maxBodyBytes?: number;
}

function defaultTurnHandler(options: ServerOptions): TurnHandler {
  return async function* (prompt, context) {
    const config = loadEffectiveConfig(options.workingDir);
    const loop = new AgentRuntimeLoop({
      provider: options.provider ?? config.defaultProvider,
      model: options.model ?? config.defaultModel,
      workingDir: options.workingDir,
      agent: 'build',
      maxIterations: 40,
      maxToolCalls: 200,
      tokenBudget: 200_000,
      durationBudget: 600_000,
      abortSignal: context.signal,
    });
    for await (const chunk of loop.run(prompt)) yield chunk;
    const usage = loop.getUsage();
    return {
      halt: loop.getHaltReason(),
      tokens: usage.totalTokens.total,
      cost: usage.totalCost.totalCost,
    };
  };
}

function scopeFor(method: string, parts: string[]): ServerScope | null {
  if (parts[0] !== 'sessions') return null;
  if (method === 'GET' && (parts.length === 1 || parts.length === 2)) return 'read';
  if (method === 'POST' && parts.length === 1) return 'write';
  if (method === 'POST' && parts.length === 3 && parts[2] === 'share') return 'write';
  if (method === 'POST' && parts.length === 3 && parts[2] === 'messages') return 'run';
  return null;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function writeEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readJson(
  req: IncomingMessage,
  limit: number
): Promise<{ value?: unknown; error?: string; status?: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) return { error: 'body too large', status: 413 };
      chunks.push(buffer);
    }
  } catch {
    return { error: 'invalid body', status: 400 };
  }
  if (chunks.length === 0) return { value: {} };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { error: 'invalid json', status: 400 };
  }
}

export class Server {
  private readonly http: ReturnType<typeof createHttpServer>;
  private readonly tokens: ServerToken[];
  private readonly sessions: Sessions;
  private readonly shares: Shares;
  private readonly turn: TurnHandler;
  private readonly maxBodyBytes: number;
  private readonly host: string;
  private readonly port: number;
  private started = false;

  constructor(options: ServerOptions = {}) {
    this.host = options.host ?? DEFAULT_SERVER_HOST;
    this.port = options.port ?? DEFAULT_SERVER_PORT;
    this.sessions = options.sessions ?? new Sessions();
    this.shares = options.shares ?? new Shares();
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.tokens = [...(options.tokens ?? [])];
    if (options.token) {
      this.tokens.push({ name: 'primary', token: options.token, scopes: ['read', 'write', 'run'] });
    }
    if (this.tokens.length === 0) {
      throw new Error('server requires at least one bearer token');
    }
    this.turn = options.runTurn ?? defaultTurnHandler(options);
    this.http = createHttpServer((req, res) => {
      void this.handle(req, res);
    });
  }

  get url(): string {
    const address = this.http.address();
    const port = address && typeof address === 'object' ? address.port : this.port;
    return `http://${this.host}:${port}`;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.http.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.http.off('error', onError);
        this.started = true;
        resolve();
      };
      this.http.once('error', onError);
      this.http.once('listening', onListening);
      this.http.listen(this.port, this.host);
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await new Promise<void>((resolve) => {
      this.http.close(() => resolve());
      this.http.closeAllConnections();
    });
  }

  private authorize(
    header: string | undefined,
    scope: ServerScope
  ): { ok: true } | { ok: false; status: number; error: string } {
    const token = bearerToken(header);
    if (!token) return { ok: false, status: 401, error: 'unauthorized' };
    const entry = this.tokens.find((candidate) => safeEqual(candidate.token, token));
    if (!entry) return { ok: false, status: 401, error: 'unauthorized' };
    if (!entry.scopes.includes(scope)) {
      return { ok: false, status: 403, error: `token lacks the "${scope}" scope` };
    }
    return { ok: true };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter((part) => part !== '');

    if (method === 'GET' && parts.length === 1 && parts[0] === 'health') {
      sendJson(res, 200, { status: 'ok', version: VERSION });
      return;
    }

    if (method === 'GET' && parts.length === 2 && parts[0] === 'share') {
      this.renderShare(res, parts[1]);
      return;
    }

    const scope = scopeFor(method, parts);
    if (!scope) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    const authorization = this.authorize(req.headers.authorization, scope);
    if (!authorization.ok) {
      sendJson(res, authorization.status, { error: authorization.error });
      return;
    }

    try {
      if (method === 'GET' && parts.length === 1) {
        this.listSessions(res);
        return;
      }
      if (method === 'GET' && parts.length === 2) {
        this.getSession(res, parts[1]);
        return;
      }
      if (method === 'POST' && parts.length === 1) {
        this.createSession(res);
        return;
      }
      if (method === 'POST' && parts[2] === 'share') {
        this.createShare(req, res, parts[1]);
        return;
      }
      await this.runMessage(req, res, parts[1]);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private listSessions(res: ServerResponse): void {
    const sessions = this.sessions.list().map((metadata) => ({
      ...metadata,
      createdAt: metadata.createdAt.toISOString(),
      updatedAt: metadata.updatedAt.toISOString(),
    }));
    sendJson(res, 200, { sessions });
  }

  private getSession(res: ServerResponse, id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    sendJson(res, 200, {
      id: session.id,
      metadata: {
        ...session.metadata,
        createdAt: session.metadata.createdAt.toISOString(),
        updatedAt: session.metadata.updatedAt.toISOString(),
      },
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp.toISOString(),
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
        ...(message.toolResults ? { toolResults: message.toolResults } : {}),
      })),
    });
  }

  private createSession(res: ServerResponse): void {
    const session = this.sessions.create();
    sendJson(res, 201, {
      id: session.id,
      createdAt: session.metadata.createdAt.toISOString(),
      updatedAt: session.metadata.updatedAt.toISOString(),
    });
  }

  private createShare(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const link = this.shares.create(session.id);
    const host = req.headers.host ?? `${this.host}:${this.port}`;
    sendJson(res, 201, {
      token: link.token,
      sessionId: link.sessionId,
      url: `http://${host}/share/${link.token}`,
      createdAt: link.createdAt.toISOString(),
    });
  }

  private renderShare(res: ServerResponse, token: string): void {
    const notFound = () => {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>Share link not found</h1></body></html>');
    };
    const link = this.shares.get(token);
    if (!link) {
      notFound();
      return;
    }
    const session = this.sessions.get(link.sessionId);
    if (!session) {
      notFound();
      return;
    }
    const html = renderSharePage(session);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  private async runMessage(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = await readJson(req, this.maxBodyBytes);
    if (body.error) {
      sendJson(res, body.status ?? 400, { error: body.error });
      return;
    }
    const content =
      typeof (body.value as { content?: unknown })?.content === 'string'
        ? ((body.value as { content: string }).content ?? '').trim()
        : '';
    if (content === '') {
      sendJson(res, 400, { error: 'content is required' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    session.messages.push({ role: 'user', content, timestamp: new Date() });
    this.sessions.save(session);

    let assistant = '';
    const persistAssistant = () => {
      if (assistant.trim() === '') return;
      session.messages.push({ role: 'assistant', content: assistant, timestamp: new Date() });
      this.sessions.save(session);
    };

    try {
      const iterator = this.turn(content, { sessionId, signal: controller.signal });
      let result: TurnResult | undefined;
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          result = next.value;
          break;
        }
        assistant += next.value;
        writeEvent(res, 'chunk', { text: next.value });
      }
      persistAssistant();
      writeEvent(res, 'done', {
        sessionId,
        halt: result?.halt ?? null,
        tokens: result?.tokens ?? 0,
        cost: result?.cost ?? 0,
      });
      res.end();
    } catch (error) {
      persistAssistant();
      writeEvent(res, 'error', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.end();
    }
  }
}
