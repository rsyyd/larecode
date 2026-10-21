import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Sessions, type ProviderMessage } from '@larecode/core';
import { Shares } from './share.js';
import { Server, type ServerOptions } from './server.js';

const TOKEN = 'test-token';
const READ_TOKEN = 'read-only-token';

let dir: string | undefined;
let server: Server | undefined;
let sessions: Sessions | undefined;

async function start(options: Partial<ServerOptions> = {}): Promise<Server> {
  dir = await mkdtemp(join(tmpdir(), 'lare-server-'));
  sessions = new Sessions(dir);
  server = new Server({
    port: 0,
    token: TOKEN,
    tokens: [{ name: 'reader', token: READ_TOKEN, scopes: ['read'] }],
    sessions,
    shares: new Shares(join(dir, 'shares.json')),
    ...options,
  });
  await server.start();
  return server;
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function auth(token = TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function createSession(instance: Server): Promise<string> {
  const response = await fetch(`${instance.url}/sessions`, { method: 'POST', headers: auth() });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe('health', () => {
  it('answers without a token', async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBeTruthy();
  });
});

describe('bearer auth and scopes', () => {
  it('rejects missing and wrong tokens', async () => {
    const instance = await start();
    expect((await fetch(`${instance.url}/sessions`)).status).toBe(401);
    expect((await fetch(`${instance.url}/sessions`, { headers: auth('wrong') })).status).toBe(401);
  });

  it('isolates scopes per token', async () => {
    const instance = await start();
    expect((await fetch(`${instance.url}/sessions`, { headers: auth(READ_TOKEN) })).status).toBe(
      200
    );
    const denied = await fetch(`${instance.url}/sessions`, {
      method: 'POST',
      headers: auth(READ_TOKEN),
    });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toContain('write');
  });
});

describe('sessions api', () => {
  it('creates, lists, and reads a session', async () => {
    const instance = await start();
    const id = await createSession(instance);

    const list = (await (await fetch(`${instance.url}/sessions`, { headers: auth() })).json()) as {
      sessions: { id: string }[];
    };
    expect(list.sessions.map((session) => session.id)).toEqual([id]);

    const detail = await fetch(`${instance.url}/sessions/${id}`, { headers: auth() });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { id: string; messages: unknown[] };
    expect(body.id).toBe(id);
    expect(body.messages).toEqual([]);
  });

  it('returns 404 for unknown sessions', async () => {
    const instance = await start();
    expect((await fetch(`${instance.url}/sessions/nope`, { headers: auth() })).status).toBe(404);
  });

  it('deletes a session with a write token and rejects read-only tokens', async () => {
    const instance = await start();
    const id = await createSession(instance);
    expect(
      (await fetch(`${instance.url}/sessions/${id}`, { method: 'DELETE', headers: auth(READ_TOKEN) }))
        .status
    ).toBe(403);
    const deleted = await fetch(`${instance.url}/sessions/${id}`, {
      method: 'DELETE',
      headers: auth(),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ deleted: true });
    expect((await fetch(`${instance.url}/sessions/${id}`, { headers: auth() })).status).toBe(404);
  });

  it('rate limits authenticated requests per token and address', async () => {
    const instance = await start({ rateLimit: { maxRequests: 2, windowMs: 60_000 } });
    expect((await fetch(`${instance.url}/sessions`, { headers: auth() })).status).toBe(200);
    expect((await fetch(`${instance.url}/sessions`, { headers: auth() })).status).toBe(200);
    const limited = await fetch(`${instance.url}/sessions`, { headers: auth() });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});

describe('share links', () => {
  async function streamTurn(instance: Server, id: string, content: string): Promise<void> {
    await (
      await fetch(`${instance.url}/sessions/${id}/messages`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ content }),
      })
    ).text();
  }

  it('requires a write-scoped token to create links', async () => {
    const instance = await start();
    const id = await createSession(instance);
    expect((await fetch(`${instance.url}/sessions/${id}/share`, { method: 'POST' })).status).toBe(
      401
    );
    expect(
      (
        await fetch(`${instance.url}/sessions/${id}/share`, {
          method: 'POST',
          headers: auth(READ_TOKEN),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${instance.url}/sessions/nope/share`, {
          method: 'POST',
          headers: auth(),
        })
      ).status
    ).toBe(404);
  });

  it('renders a public read-only replay without auth', async () => {
    const instance = await start({
      runTurn: async function* () {
        yield 'replayed answer';
        return { halt: null, tokens: 3, cost: 0 };
      },
    });
    const id = await createSession(instance);
    await streamTurn(instance, id, 'hello share');

    const response = await fetch(`${instance.url}/sessions/${id}/share`, {
      method: 'POST',
      headers: auth(),
    });
    expect(response.status).toBe(201);
    const link = (await response.json()) as { token: string; url: string };
    expect(link.url).toBe(`${instance.url}/share/${link.token}`);

    const page = await fetch(link.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('hello share');
    expect(html).toContain('replayed answer');
    expect(html).toContain('read-only replay');
  });

  it('redacts secrets in the replay', async () => {
    const instance = await start({
      runTurn: async function* () {
        yield 'ok';
        return { halt: null, tokens: 1, cost: 0 };
      },
    });
    const id = await createSession(instance);
    await streamTurn(instance, id, 'deploy with sk-ant-abcdefghijklmnop');
    const { token } = (await (
      await fetch(`${instance.url}/sessions/${id}/share`, {
        method: 'POST',
        headers: auth(),
      })
    ).json()) as { token: string };
    const html = await (await fetch(`${instance.url}/share/${token}`)).text();
    expect(html).not.toContain('sk-ant-abcdefghijklmnop');
    expect(html).toContain('[REDACTED]');
  });

  it('returns 404 for unknown share tokens', async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/share/${'a'.repeat(32)}`);
    expect(response.status).toBe(404);
  });
});

describe('sse turn', () => {
  it('streams a turn end-to-end and persists both messages', async () => {
    const instance = await start({
      runTurn: async function* (prompt) {
        yield `echo:${prompt} `;
        yield 'done';
        return { halt: null, tokens: 7, cost: 0.001 };
      },
    });
    const id = await createSession(instance);
    const response = await fetch(`${instance.url}/sessions/${id}/messages`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const text = await response.text();
    expect(text).toContain('event: chunk');
    expect(text).toContain('"text":"echo:hello "');
    expect(text).toContain('event: done');
    expect(text).toContain('"tokens":7');
    expect(text).toContain('"cost":0.001');

    const session = sessions?.get(id);
    expect(session?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(session?.messages[0].content).toBe('hello');
    expect(session?.messages[1].content).toBe('echo:hello done');
  });

  it('passes prior turns as history', async () => {
    const histories: ProviderMessage[][] = [];
    const instance = await start({
      runTurn: async function* (prompt, context) {
        histories.push(context.history);
        yield prompt;
        return { halt: null, tokens: 1, cost: 0 };
      },
    });
    const id = await createSession(instance);

    for (const content of ['one', 'two', 'three']) {
      await fetch(`${instance.url}/sessions/${id}/messages`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ content }),
      });
    }

    expect(histories.map((history) => history.length)).toEqual([0, 2, 4]);
    expect(histories[2]).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: 'two' },
    ]);
  });

  it('rejects missing sessions, empty content, and invalid json', async () => {
    const instance = await start();
    const missing = await fetch(`${instance.url}/sessions/nope/messages`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ content: 'hi' }),
    });
    expect(missing.status).toBe(404);

    const id = await createSession(instance);
    const empty = await fetch(`${instance.url}/sessions/${id}/messages`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ content: '   ' }),
    });
    expect(empty.status).toBe(400);

    const invalid = await fetch(`${instance.url}/sessions/${id}/messages`, {
      method: 'POST',
      headers: auth(),
      body: '{nope',
    });
    expect(invalid.status).toBe(400);
  });

  it('enforces the body limit', async () => {
    const instance = await start({ maxBodyBytes: 16 });
    const id = await createSession(instance);
    const response = await fetch(`${instance.url}/sessions/${id}/messages`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ content: 'x'.repeat(100) }),
    });
    expect(response.status).toBe(413);
  });

  it('aborts the turn when the client disconnects', async () => {
    let aborted = false;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const instance = await start({
      runTurn: async function* (_prompt, context) {
        markStarted();
        yield 'partial';
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            aborted = true;
            resolve();
            return;
          }
          context.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          );
        });
        return { halt: null, tokens: 1, cost: 0 };
      },
    });
    const sessionId = await createSession(instance);
    const controller = new AbortController();
    const response = await fetch(`${instance.url}/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ content: 'go' }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing response body');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('partial');

    controller.abort();
    await started;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(aborted).toBe(true);
  });

  it('reports handler failures as SSE error events and keeps partial output', async () => {
    const instance = await start({
      runTurn: async function* () {
        yield 'partial ';
        throw new Error('boom');
      },
    });
    const id = await createSession(instance);
    const text = await (
      await fetch(`${instance.url}/sessions/${id}/messages`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ content: 'go' }),
      })
    ).text();
    expect(text).toContain('event: error');
    expect(text).toContain('"message":"boom"');

    const session = sessions?.get(id);
    expect(session?.messages.at(-1)?.content).toBe('partial ');
  });
});
