import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Sessions } from '@lumpscode/core';
import { Server, type ServerOptions } from './server.js';

const TOKEN = 'test-token';
const READ_TOKEN = 'read-only-token';

let dir: string | undefined;
let server: Server | undefined;
let sessions: Sessions | undefined;

async function start(options: Partial<ServerOptions> = {}): Promise<Server> {
  dir = await mkdtemp(join(tmpdir(), 'lumps-server-'));
  sessions = new Sessions(dir);
  server = new Server({
    port: 0,
    token: TOKEN,
    tokens: [{ name: 'reader', token: READ_TOKEN, scopes: ['read'] }],
    sessions,
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
