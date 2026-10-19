import { LareError } from '../error/error.js';
import type { Tool, ToolContext } from './tool.js';
import { parseHttpUrl } from './web.js';

export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
export const CDP_TIMEOUT_MS = 10_000;
export const BROWSER_SNAPSHOT_MAX_CHARS = 20_000;

export function cdpEndpoint(): string {
  return process.env.LARECODE_CDP_URL ?? DEFAULT_CDP_ENDPOINT;
}

interface WsEvent {
  data: unknown;
}

interface WebSocketLike {
  addEventListener(
    type: string,
    listener: (event: WsEvent) => void,
    options?: { once?: boolean }
  ): void;
  send(data: string): void;
  close(): void;
}

type WebSocketCtor = new (url: string) => WebSocketLike;

interface CdpTarget {
  id?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  private constructor(private readonly ws: WebSocketLike) {
    ws.addEventListener('message', (event) => this.onMessage(event));
  }

  static async attach(endpoint: string): Promise<CdpSession> {
    const targets = await listTargets(endpoint);
    const existing = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
    const target = existing ?? (await createTarget(endpoint));
    const wsUrl = target?.webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new LareError(
        'NETWORK_ERROR',
        'no debuggable page target found; open a tab in the browser'
      );
    }
    const Ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) {
      throw new LareError('NETWORK_ERROR', 'WebSocket is not available in this runtime');
    }
    const ws = new Ctor(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new LareError('NETWORK_ERROR', 'timed out connecting to the browser websocket')),
        5000
      );
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new LareError('NETWORK_ERROR', 'failed to open the browser websocket'));
        },
        { once: true }
      );
    });
    return new CdpSession(ws);
  }

  private onMessage(event: WsEvent): void {
    let message: CdpResponse;
    try {
      message = JSON.parse(String(event.data)) as CdpResponse;
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(
        new LareError('NETWORK_ERROR', `cdp error: ${message.error.message ?? 'unknown'}`)
      );
    } else {
      entry.resolve(message.result);
    }
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new LareError('NETWORK_ERROR', 'browser connection closed'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LareError('NETWORK_ERROR', `cdp call timed out: ${method}`));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new LareError('NETWORK_ERROR', 'browser connection closed'));
    }
    this.pending.clear();
    try {
      this.ws.close();
    } catch {
      void 0;
    }
  }
}

async function listTargets(endpoint: string): Promise<CdpTarget[]> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new LareError('NETWORK_ERROR', `browser not reachable at ${endpoint}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (!response.ok) {
    throw new LareError(
      'NETWORK_ERROR',
      `browser not reachable at ${endpoint} (HTTP ${response.status})`
    );
  }
  return (await response.json()) as CdpTarget[];
}

async function createTarget(endpoint: string): Promise<CdpTarget | undefined> {
  try {
    const response = await fetch(`${endpoint}/json/new?about:blank`, {
      method: 'PUT',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as CdpTarget;
  } catch {
    return undefined;
  }
}

async function evaluate(session: CdpSession, expression: string): Promise<unknown> {
  const result = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result?.result?.value;
}

interface BrowserArgs {
  action?: string;
  url?: string;
  selector?: string;
  text?: string;
}

export const BROWSER_ACTIONS = ['navigate', 'snapshot', 'click', 'type'];

export function browserTool(options: { endpoint?: string } = {}): Tool {
  const endpoint = options.endpoint ?? cdpEndpoint();
  return {
    name: 'browser',
    description: `Control a Chrome browser over the DevTools protocol at ${endpoint} (override with LARECODE_CDP_URL). Actions: navigate (http/https), snapshot (title, url, visible text), click (CSS selector), type (CSS selector + text). Requires the browser permission group.`,
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: `One of: ${BROWSER_ACTIONS.join(', ')}`,
        },
        url: { type: 'string', description: 'navigate: absolute http(s) URL' },
        selector: { type: 'string', description: 'click/type: CSS selector' },
        text: { type: 'string', description: 'type: text to enter' },
      },
      required: ['action'],
    },
    async execute(args, context) {
      const { action, url, selector, text } = (args ?? {}) as BrowserArgs;
      if (typeof action !== 'string' || !BROWSER_ACTIONS.includes(action)) {
        throw new LareError(
          'TOOL_EXECUTION_FAILED',
          `browser action must be one of: ${BROWSER_ACTIONS.join(', ')}`
        );
      }
      let target: URL | undefined;
      if (action === 'navigate') target = parseHttpUrl(url);
      requireBrowserPermission(context, `browser:${action}${target ? `:${target.hostname}` : ''}`);
      if (
        (action === 'click' || action === 'type') &&
        (typeof selector !== 'string' || selector.trim() === '')
      ) {
        throw new LareError('TOOL_EXECUTION_FAILED', `${action} requires a selector`);
      }
      if (action === 'type' && typeof text !== 'string') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'type requires text');
      }

      const session = await CdpSession.attach(endpoint);
      try {
        if (action === 'navigate') {
          await session.send('Page.navigate', { url: target!.href });
          return { action, url: target!.href };
        }
        if (action === 'snapshot') {
          const value = (await evaluate(
            session,
            '({ title: document.title, url: location.href, text: document.body ? document.body.innerText : "" })'
          )) as { title?: string; url?: string; text?: string } | undefined;
          const body = value?.text ?? '';
          const truncated = body.length > BROWSER_SNAPSHOT_MAX_CHARS;
          return {
            action,
            url: value?.url ?? '',
            title: value?.title ?? '',
            text: truncated ? body.slice(0, BROWSER_SNAPSHOT_MAX_CHARS) : body,
            truncated,
          };
        }
        if (action === 'click') {
          const clicked = await evaluate(
            session,
            `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`
          );
          if (clicked !== true) {
            throw new LareError('TOOL_EXECUTION_FAILED', `selector not found: ${selector}`);
          }
          return { action, clicked: true };
        }
        const typed = await evaluate(
          session,
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); if ('value' in el) { el.value = ${JSON.stringify(text)}; } else if (el.isContentEditable) { el.textContent = ${JSON.stringify(text)}; } else { return false; } el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
        );
        if (typed !== true) {
          throw new LareError(
            'TOOL_EXECUTION_FAILED',
            `selector not found or not typable: ${selector}`
          );
        }
        return { action, typed: true };
      } finally {
        session.close();
      }
    },
  };
}

function requireBrowserPermission(context: ToolContext, source: string): void {
  const decision = context.permissions.check('browser', { source });
  if (!decision.allowed) {
    throw new LareError(
      'PERMISSION_DENIED',
      decision.reason ?? 'browser control requires the browser permission group',
      { context: { source } }
    );
  }
}
