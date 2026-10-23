import { afterEach, describe, expect, it, vi } from 'vitest';
import { Permissions } from '../permission/permission.js';
import type { ToolContext } from './tool.js';
import { BROWSER_ACTIONS, browserTool, cdpEndpoint } from './browser.js';

const ALLOW_BROWSER = { mode: 'allow' as const, allowedGroups: ['browser' as const] };

function ctx(permissions: Permissions): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: process.cwd(),
    permissions,
    abortSignal: new AbortController().signal,
  };
}

type Listener = (event: { data?: unknown }) => void;

class FakeSocket {
  static responder: (method: string, params: Record<string, unknown>) => unknown = () => ({});
  static last: FakeSocket | null = null;
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];

  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, listener: Listener): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  send(data: string): void {
    const message = JSON.parse(data) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    this.sent.push(message);
    queueMicrotask(() => {
      const result = FakeSocket.responder(message.method, message.params);
      this.emit('message', { data: JSON.stringify({ id: message.id, result }) });
    });
  }

  close(): void {
    this.emit('close', {});
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function fakeBrowser(
  targets: Array<Record<string, unknown>> = [
    { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' },
  ],
  responder?: (method: string, params: Record<string, unknown>) => unknown
): ReturnType<typeof vi.fn> {
  FakeSocket.responder = responder ?? (() => ({}));
  vi.stubGlobal('WebSocket', FakeSocket);
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (href.includes('/json/list')) return new Response(JSON.stringify(targets));
    return new Response(
      JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/2' })
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  FakeSocket.last = null;
});

describe('cdpEndpoint', () => {
  it('defaults to the local chrome port and honors LARECODE_CDP_URL', () => {
    expect(cdpEndpoint()).toBe('http://127.0.0.1:9222');
    vi.stubEnv('LARECODE_CDP_URL', 'http://127.0.0.1:9333');
    expect(cdpEndpoint()).toBe('http://127.0.0.1:9333');
  });
});

describe('browser tool', () => {
  it('rejects unknown actions', async () => {
    await expect(
      browserTool().execute({ action: 'launch' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(new RegExp(BROWSER_ACTIONS.join(', ')));
  });

  it('rejects non-http navigation before the permission check', async () => {
    await expect(
      browserTool().execute(
        { action: 'navigate', url: 'file:///etc/passwd' },
        ctx(new Permissions())
      )
    ).rejects.toThrow(/unsupported protocol/);
  });

  it('denies control without the browser permission group', async () => {
    await expect(
      browserTool().execute({ action: 'snapshot' }, ctx(new Permissions()))
    ).rejects.toThrow(/browser/);
  });

  it('requires a selector for click and type', async () => {
    const tool = browserTool();
    await expect(
      tool.execute({ action: 'click', selector: ' ' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(/requires a selector/);
    await expect(
      tool.execute({ action: 'type', selector: 'input' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(/requires text/);
  });

  it('reports an unreachable browser as NETWORK_ERROR', async () => {
    await expect(
      browserTool({ endpoint: 'http://127.0.0.1:1' }).execute(
        { action: 'snapshot' },
        ctx(new Permissions(ALLOW_BROWSER))
      )
    ).rejects.toThrow(/browser not reachable at http:\/\/127\.0\.0\.1:1/);
  });

  it('navigates through the first CDP page target', async () => {
    const fetchMock = fakeBrowser();
    const result = await browserTool().execute(
      { action: 'navigate', url: 'https://example.com' },
      ctx(new Permissions(ALLOW_BROWSER))
    );
    expect(result).toEqual({ action: 'navigate', url: 'https://example.com/' });
    expect(FakeSocket.last?.sent[0]).toMatchObject({
      method: 'Page.navigate',
      params: { url: 'https://example.com/' },
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9222/json/list', expect.anything());
  });

  it('creates a page target when the browser has none', async () => {
    const fetchMock = fakeBrowser([]);
    await browserTool().execute(
      { action: 'navigate', url: 'https://example.com' },
      ctx(new Permissions(ALLOW_BROWSER))
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/json/new');
  });

  it('captures and truncates a snapshot', async () => {
    fakeBrowser(undefined, () => ({
      result: {
        value: {
          title: 'Example',
          url: 'https://example.com/',
          text: 'x'.repeat(20_001),
        },
      },
    }));
    const result = (await browserTool().execute(
      { action: 'snapshot' },
      ctx(new Permissions(ALLOW_BROWSER))
    )) as { title: string; text: string; truncated: boolean };
    expect(result.title).toBe('Example');
    expect(result.text).toHaveLength(20_000);
    expect(result.truncated).toBe(true);
  });

  it('clicks and types through the CDP runtime', async () => {
    fakeBrowser(undefined, () => ({ result: { value: true } }));
    const permissions = new Permissions(ALLOW_BROWSER);
    const tool = browserTool();
    await expect(
      tool.execute({ action: 'click', selector: '#go' }, ctx(permissions))
    ).resolves.toEqual({ action: 'click', clicked: true });
    await expect(
      tool.execute({ action: 'type', selector: '#name', text: 'Ada' }, ctx(permissions))
    ).resolves.toEqual({ action: 'type', typed: true });
    expect(FakeSocket.last?.sent.map((message) => message.method)).toEqual(['Runtime.evaluate']);
  });

  it('reports a missing selector for click and type', async () => {
    fakeBrowser(undefined, () => ({ result: { value: false } }));
    const permissions = new Permissions(ALLOW_BROWSER);
    const tool = browserTool();
    await expect(
      tool.execute({ action: 'click', selector: '#missing' }, ctx(permissions))
    ).rejects.toThrow(/selector not found/);
    await expect(
      tool.execute({ action: 'type', selector: '#missing', text: 'x' }, ctx(permissions))
    ).rejects.toThrow(/not typable/);
  });

  it('fails clearly when the runtime has no WebSocket or page target', async () => {
    fakeBrowser();
    vi.stubGlobal('WebSocket', undefined);
    await expect(
      browserTool().execute({ action: 'snapshot' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(/WebSocket is not available/);

    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200 }))
    );
    await expect(
      browserTool().execute({ action: 'snapshot' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(/no debuggable page target/);
  });
});
