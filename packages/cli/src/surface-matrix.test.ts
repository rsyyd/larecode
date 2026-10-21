import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentRuntimeLoop,
  ChatSession,
  Permissions,
  Providers,
  Sessions,
  Tools,
  runCronJob,
  type AgentRuntimeLoopOptions,
  type CronJob,
  type ProviderAdapter,
  type ProviderMessage,
  type ProviderStreamEvent,
} from '@larecode/core';
import { ChatSessions, TelegramGateway, type TelegramUpdate } from '@larecode/gateway';
import { AcpAgent, LareClient } from '@larecode/sdk';
import { Server } from '@larecode/server';
import { runTask } from './run.js';

const PROVIDER = 'matrix';
const MODEL = 'matrix-1';

class MatrixAdapter implements ProviderAdapter {
  readonly name = PROVIDER;
  readonly capabilities = {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };
  readonly requests: ProviderMessage[][] = [];

  async models() {
    return [];
  }

  async complete(): Promise<string> {
    return 'matrix-ok';
  }

  async *streamComplete(): AsyncGenerator<string> {
    yield 'matrix-ok';
  }

  async *streamChat(messages: ProviderMessage[]): AsyncGenerator<ProviderStreamEvent> {
    this.requests.push(messages.map((message) => ({ ...message })));
    yield { type: 'text', text: 'matrix-' };
    yield { type: 'text', text: 'ok' };
  }
}

function allow(): Permissions {
  return new Permissions({ mode: 'allow', allowedGroups: [] });
}

function matrix(options: Partial<AgentRuntimeLoopOptions> = {}) {
  const adapter = new MatrixAdapter();
  const providers = new Providers();
  providers.register(adapter);
  const loop = new AgentRuntimeLoop({
    provider: PROVIDER,
    model: MODEL,
    agent: 'build',
    permissions: allow(),
    tools: new Tools(),
    ...options,
    providers,
  });
  return { adapter, loop, providers };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-matrix-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('surface integration matrix', () => {
  it('streams through the chat surface', async () => {
    const { adapter, providers } = matrix();
    const session = new ChatSession({
      provider: PROVIDER,
      model: MODEL,
      agent: 'build',
      workingDir: dir,
      providers,
      tools: new Tools(),
      permissions: allow(),
    });

    let text = '';
    for await (const event of session.run('matrix check', {
      signal: new AbortController().signal,
    })) {
      if (event.type === 'text') text += event.text;
    }

    expect(text).toBe('matrix-ok');
    expect(adapter.requests).toHaveLength(1);
    expect(session.getHistory().map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
    ]);
    expect(session.getUsage().totalTokens.total).toBeGreaterThan(0);
  });

  it('streams through the run surface', async () => {
    let adapter: MatrixAdapter | undefined;
    let output = '';

    const result = await runTask(
      { task: 'matrix check', provider: PROVIDER, model: MODEL },
      {
        cwd: dir,
        write: (chunk) => {
          output += chunk;
        },
        createLoop: () => {
          const runtime = matrix({ workingDir: dir });
          adapter = runtime.adapter;
          return runtime.loop;
        },
      }
    );

    expect(result.exitCode).toBe(0);
    expect(output).toContain('matrix-ok');
    expect(adapter?.requests).toHaveLength(1);
  });

  it('streams through the server surface and persists the turn', async () => {
    const sessions = new Sessions(join(dir, 'server-sessions'));
    let adapter: MatrixAdapter | undefined;
    const server = new Server({
      port: 0,
      token: 'matrix-token',
      sessions,
      workingDir: dir,
      runTurn: async function* (prompt, context) {
        const runtime = matrix({
          workingDir: dir,
          history: context.history,
          abortSignal: context.signal,
        });
        adapter = runtime.adapter;
        for await (const chunk of runtime.loop.run(prompt)) yield chunk;
        const usage = runtime.loop.getUsage();
        return {
          halt: runtime.loop.getHaltReason(),
          tokens: usage.totalTokens.total,
          cost: usage.totalCost.totalCost,
        };
      },
    });
    await server.start();

    try {
      const headers = {
        authorization: 'Bearer matrix-token',
        'content-type': 'application/json',
      };
      const created = (await (
        await fetch(`${server.url}/sessions`, { method: 'POST', headers })
      ).json()) as { id: string };
      const response = await fetch(`${server.url}/sessions/${created.id}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: 'matrix check' }),
      });
      const text = await response.text();

      expect(text).toContain('event: chunk');
      expect(text).toContain('event: done');
      expect(sessions.get(created.id)?.messages.at(-1)?.content).toBe('matrix-ok');
      expect(adapter?.requests).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('streams through the ACP surface', async () => {
    const out: {
      id?: number | string | null;
      method?: string;
      result?: { stopReason?: string; sessionId?: string };
      params?: { sessionId?: string; update?: { content?: { text?: string } } };
    }[] = [];
    const agent = new AcpAgent({
      version: '9.9.9',
      sessions: new Sessions(join(dir, 'acp-sessions')),
      send: (message) => out.push(message as (typeof out)[number]),
      runTurn: async (prompt, context) => {
        const runtime = matrix({
          workingDir: dir,
          abortSignal: context.signal,
        });
        for await (const chunk of runtime.loop.run(prompt)) context.onChunk(chunk);
        return 'end_turn';
      },
    });

    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {} },
      })
    );
    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: { cwd: dir, mcpServers: [] },
      })
    );
    const sessionId = out.at(-1)?.result?.sessionId;
    if (!sessionId) throw new Error('session/new did not return a session id');
    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId, prompt: [{ type: 'text', text: 'matrix check' }] },
      })
    );

    const updates = out.filter((message) => message.method === 'session/update');
    expect(updates.map((message) => message.params?.update?.content?.text)).toEqual([
      'matrix-',
      'ok',
    ]);
    expect(out.at(-1)?.result?.stopReason).toBe('end_turn');
  });

  it('sends accumulated history across three server turns', async () => {
    const sessions = new Sessions(join(dir, 'server-history'));
    const histories: ProviderMessage[][] = [];
    const server = new Server({
      port: 0,
      token: 'history-token',
      sessions,
      workingDir: dir,
      runTurn: async function* (_prompt, context) {
        histories.push(context.history);
        yield `reply-${histories.length}`;
        return { halt: null, tokens: 0, cost: 0 };
      },
    });
    await server.start();

    try {
      const headers = {
        authorization: 'Bearer history-token',
        'content-type': 'application/json',
      };
      const created = (await (
        await fetch(`${server.url}/sessions`, { method: 'POST', headers })
      ).json()) as { id: string };
      for (const content of ['one', 'two', 'three']) {
        const response = await fetch(`${server.url}/sessions/${created.id}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ content }),
        });
        await response.text();
      }
    } finally {
      await server.stop();
    }

    expect(histories.map((history) => history.length)).toEqual([0, 2, 4]);
    expect(histories[2]?.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:one',
      'assistant:reply-1',
      'user:two',
      'assistant:reply-2',
    ]);
  });

  it('keeps history across three ACP turns', async () => {
    const histories: ProviderMessage[][] = [];
    const out: { result?: { sessionId?: string } }[] = [];
    const agent = new AcpAgent({
      sessions: new Sessions(join(dir, 'acp-history')),
      provider: PROVIDER,
      model: MODEL,
      send: (message) => out.push(message as (typeof out)[number]),
      loopFactory: (options) => {
        histories.push(options.history ?? []);
        return matrix(options).loop;
      },
    });

    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {} },
      })
    );
    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: { cwd: dir, mcpServers: [] },
      })
    );

    const send = async (id: number, sessionId: string, text: string): Promise<void> => {
      await agent.handleLine(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'session/prompt',
          params: { sessionId, prompt: [{ type: 'text', text }] },
        })
      );
    };

    const sessionId = out.at(-1)?.result?.sessionId;
    if (!sessionId) throw new Error('session/new did not return a session id');
    await send(2, sessionId, 'one');
    await send(3, sessionId, 'two');
    await send(4, sessionId, 'three');

    expect(histories.map((history) => history.length)).toEqual([0, 2, 4]);
    expect(histories[2]?.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:one',
      'assistant:matrix-ok',
      'user:two',
      'assistant:matrix-ok',
    ]);
  });

  it('keeps history across three SDK turns', async () => {
    const histories: ProviderMessage[][] = [];
    const client = new LareClient({
      workingDir: dir,
      provider: PROVIDER,
      model: MODEL,
      sessions: new Sessions(join(dir, 'sdk-history')),
      loopFactory: (options) => {
        histories.push(options.history ?? []);
        return matrix(options).loop;
      },
    });
    const session = client.sessions.create();

    for (const prompt of ['one', 'two', 'three']) {
      await client.run(prompt, { sessionId: session.id });
    }

    expect(histories.map((history) => history.length)).toEqual([0, 2, 4]);
    expect(histories[2]?.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:one',
      'assistant:matrix-ok',
      'user:two',
      'assistant:matrix-ok',
    ]);
  });

  it('continues one session across server, SDK, and ACP', async () => {
    const sessions = new Sessions(join(dir, 'cross-surface'));
    const histories: ProviderMessage[][] = [];
    const server = new Server({
      port: 0,
      token: 'cross-token',
      sessions,
      workingDir: dir,
      runTurn: async function* (_prompt, context) {
        histories.push(context.history);
        yield 'server reply';
        return { halt: null, tokens: 0, cost: 0 };
      },
    });
    await server.start();

    let sessionId: string;
    try {
      const headers = {
        authorization: 'Bearer cross-token',
        'content-type': 'application/json',
      };
      const created = (await (
        await fetch(`${server.url}/sessions`, { method: 'POST', headers })
      ).json()) as { id: string };
      sessionId = created.id;
      const response = await fetch(`${server.url}/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: 'from server' }),
      });
      await response.text();
    } finally {
      await server.stop();
    }

    const client = new LareClient({
      workingDir: dir,
      provider: PROVIDER,
      model: MODEL,
      sessions,
      loopFactory: (options) => {
        histories.push(options.history ?? []);
        return matrix(options).loop;
      },
    });
    await client.run('from sdk', { sessionId });

    expect(histories[1]?.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:from server',
      'assistant:server reply',
    ]);
    expect(sessions.get(sessionId)?.messages.map((message) => message.content)).toEqual([
      'from server',
      'server reply',
      'from sdk',
      'matrix-ok',
    ]);

    const out: { result?: { sessionId?: string } }[] = [];
    const agent = new AcpAgent({
      sessions,
      provider: PROVIDER,
      model: MODEL,
      send: (message) => out.push(message as (typeof out)[number]),
      loopFactory: (options) => {
        histories.push(options.history ?? []);
        return matrix(options).loop;
      },
    });
    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {} },
      })
    );
    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: { cwd: dir, mcpServers: [] },
      })
    );
    const acpSession = out.at(-1)?.result?.sessionId;
    if (!acpSession) throw new Error('session/new did not return a session id');
    await agent.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: { sessionId: acpSession, prompt: [{ type: 'text', text: 'from acp' }] },
      })
    );
    await client.run('after acp', { sessionId: acpSession });

    expect(histories.at(-1)?.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:from acp',
      'assistant:matrix-ok',
    ]);
    expect(sessions.get(acpSession)?.messages.map((message) => message.content)).toEqual([
      'from acp',
      'matrix-ok',
      'after acp',
      'matrix-ok',
    ]);
  });

  it('streams through the gateway surface', async () => {
    const sessions = new Sessions(join(dir, 'gateway-sessions'));
    const sent: { chat_id: string; text: string }[] = [];
    let adapter: MatrixAdapter | undefined;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).includes('/sendMessage')) {
        sent.push(JSON.parse(String(init?.body)) as { chat_id: string; text: string });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const gateway = new TelegramGateway({
      token: 'TEST',
      allowedChatId: '42',
      sessions,
      chatSessions: new ChatSessions(join(dir, 'gateway.json'), sessions),
      fetchImpl,
      createLoop: (options) => {
        const runtime = matrix({
          workingDir: dir,
          history: options.history,
          abortSignal: options.abortSignal,
        });
        adapter = runtime.adapter;
        return runtime.loop;
      },
    });
    const update: TelegramUpdate = {
      update_id: 1,
      message: { message_id: 1, chat: { id: 42 }, text: 'matrix check' },
    };

    await gateway.handleUpdate(update);

    expect(sent.map((message) => message.text)).toEqual(['matrix-ok']);
    expect(adapter?.requests).toHaveLength(1);
  });

  it('streams through the cron surface', async () => {
    let adapter: MatrixAdapter | undefined;
    const job: CronJob = {
      id: 'matrix',
      name: 'matrix check',
      schedule: '* * * * *',
      prompt: 'matrix check',
      policy: [],
      enabled: true,
      createdAt: new Date(),
    };

    const result = await runCronJob(job, {
      cwd: dir,
      loadConfig: () => ({ defaultProvider: PROVIDER, defaultModel: MODEL }),
      createLoop: (options) => {
        const runtime = matrix({ workingDir: dir, abortSignal: options.abortSignal });
        adapter = runtime.adapter;
        return runtime.loop;
      },
    });

    expect(result.status).toBe('ok');
    expect(result.output).toBe('matrix-ok');
    expect(result.tokens).toBeGreaterThan(0);
    expect(adapter?.requests).toHaveLength(1);
  });

  it('streams through the SDK surface', async () => {
    let adapter: MatrixAdapter | undefined;
    const client = new LareClient({
      workingDir: dir,
      provider: PROVIDER,
      model: MODEL,
      sessions: new Sessions(join(dir, 'sdk-sessions')),
      loopFactory: (options) => {
        const runtime = matrix(options);
        adapter = runtime.adapter;
        return runtime.loop;
      },
    });

    const result = await client.run('matrix check');

    expect(result.text).toBe('matrix-ok');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage.totalTokens.total).toBeGreaterThan(0);
    expect(adapter?.requests).toHaveLength(1);
  });
});
