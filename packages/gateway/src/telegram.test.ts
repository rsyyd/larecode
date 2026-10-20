import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sessions } from '@larecode/core';
import {
  ChatSessions,
  TelegramGateway,
  chunkText,
  type GatewayLoop,
  type TelegramUpdate,
} from './telegram.js';

const ALLOWED = '42';

let dir: string;
let sessions: Sessions;
let chatSessions: ChatSessions;

interface Sent {
  chat_id: string;
  text: string;
}

function fakeApi(batches: TelegramUpdate[][] = []) {
  const sends: Sent[] = [];
  const polls: string[] = [];
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const url = String(input);
    if (url.includes('/getUpdates')) {
      polls.push(url);
      return new Response(JSON.stringify({ ok: true, result: batches.shift() ?? [] }), {
        status: 200,
      });
    }
    if (url.includes('/sendMessage')) {
      sends.push(JSON.parse(String(init?.body)) as Sent);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, sends, polls };
}

function fakeLoop(chunks: string[]): GatewayLoop {
  return {
    async *run() {
      for (const chunk of chunks) yield chunk;
    },
    getUsage: () => ({ totalTokens: { total: 3 }, totalCost: { totalCost: 0.0001 } }),
    getHaltReason: () => null,
  } as unknown as GatewayLoop;
}

function update(id: number, chatId: string, text: string): TelegramUpdate {
  return { update_id: id, message: { message_id: id, chat: { id: chatId }, text } };
}

function gateway(overrides: Partial<ConstructorParameters<typeof TelegramGateway>[0]> = {}) {
  const api = fakeApi();
  const instance = new TelegramGateway({
    token: 'TEST',
    allowedChatId: ALLOWED,
    sessions,
    chatSessions,
    fetchImpl: api.fetchImpl,
    loadConfig: () => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }),
    createLoop: () => fakeLoop(['ok']),
    ...overrides,
  });
  return { instance, api };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-gateway-'));
  sessions = new Sessions(join(dir, 'sessions'));
  chatSessions = new ChatSessions(join(dir, 'gateway.json'), sessions);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('handleUpdate', () => {
  it('answers /start and /help without touching sessions', async () => {
    const { instance, api } = gateway();
    await instance.handleUpdate(update(1, ALLOWED, '/start'));
    expect(api.sends[0].text).toContain('send me a task');
    await instance.handleUpdate(update(2, ALLOWED, '/help'));
    expect(api.sends).toHaveLength(2);
    expect(sessions.list()).toHaveLength(0);
  });

  it('refuses unauthorized chats with setup instructions', async () => {
    const { instance, api } = gateway();
    await instance.handleUpdate(update(1, '999', 'hello?'));
    expect(api.sends[0].chat_id).toBe('999');
    expect(api.sends[0].text).toContain('not authorized');
    expect(api.sends[0].text).toContain('chat id 999');
    expect(sessions.list()).toHaveLength(0);
  });

  it('runs a task, replies, and keeps conversation continuity', async () => {
    const { instance, api } = gateway({
      createLoop: () => fakeLoop(['done with ', 'the task']),
    });
    await instance.handleUpdate(update(7, ALLOWED, 'audit the repo'));
    expect(api.sends[0].text).toBe('done with the task');

    const [meta] = sessions.list();
    expect(meta.messageCount).toBe(2);
    const session = sessions.get(meta.id);
    expect(session?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(session?.messages[0].content).toBe('audit the repo');
    expect(session?.messages[1].content).toBe('done with the task');

    await instance.handleUpdate(update(8, ALLOWED, 'again'));
    expect(sessions.list()).toHaveLength(1);
    expect(sessions.get(meta.id)?.messages).toHaveLength(4);
  });

  it('runs turns unattended with its pre-authorized policy', async () => {
    let unattended = false;
    let readAllowed = false;
    let shellAllowed = false;
    const { instance } = gateway({
      policy: ['read'],
      createLoop: (options) => {
        unattended = options.unattended === true;
        readAllowed = options.permissions?.check('read', { unattended: true }).allowed === true;
        shellAllowed = options.permissions?.check('shell', { unattended: true }).allowed === true;
        return fakeLoop(['ok']);
      },
    });

    await instance.handleUpdate(update(1, ALLOWED, 'go'));

    expect(unattended).toBe(true);
    expect(readAllowed).toBe(true);
    expect(shellAllowed).toBe(false);
  });

  it('starts a fresh session on /new', async () => {
    const { instance } = gateway();
    await instance.handleUpdate(update(1, ALLOWED, 'first'));
    const first = sessions.list()[0].id;
    await instance.handleUpdate(update(2, ALLOWED, '/new'));
    await instance.handleUpdate(update(3, ALLOWED, 'second'));
    expect(sessions.list()).toHaveLength(2);
    expect(sessions.list().every((meta) => meta.id !== undefined)).toBe(true);
    expect(chatSessions.getOrCreate(ALLOWED)).not.toBe(first);
  });

  it('reports turn failures in the chat and in the session', async () => {
    const failing = {
      async *run() {
        yield 'partial ';
        throw new Error('provider exploded');
      },
      getUsage: () => ({ totalTokens: { total: 0 }, totalCost: { totalCost: 0 } }),
      getHaltReason: () => null,
    } as unknown as GatewayLoop;
    const { instance, api } = gateway({ createLoop: () => failing });
    await instance.handleUpdate(update(1, ALLOWED, 'go'));
    expect(api.sends[0].text).toBe('partial \nerror: provider exploded');
    expect(sessions.get(sessions.list()[0].id)?.messages[1].content).toContain('error:');
  });

  it('ignores updates without text', async () => {
    const { instance, api } = gateway();
    await instance.handleUpdate({
      update_id: 1,
      message: { message_id: 1, chat: { id: ALLOWED } },
    });
    await instance.handleUpdate({ update_id: 2 });
    expect(api.sends).toHaveLength(0);
  });
});

describe('run', () => {
  it('polls, advances the offset, and stops on abort', async () => {
    const controller = new AbortController();
    let calls = 0;
    const polls: string[] = [];
    const sends: Sent[] = [];
    const fetchImpl = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const url = String(input);
      if (url.includes('/getUpdates')) {
        polls.push(url);
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ ok: true, result: [update(5, ALLOWED, 'ping')] }), {
            status: 200,
          });
        }
        controller.abort();
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      sends.push(JSON.parse(String(init?.body)) as Sent);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const instance = new TelegramGateway({
      token: 'T',
      allowedChatId: ALLOWED,
      sessions,
      chatSessions,
      fetchImpl,
      createLoop: () => fakeLoop(['pong']),
      loadConfig: () => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }),
    });
    await instance.run(controller.signal);
    expect(polls).toHaveLength(2);
    expect(polls[1]).toContain('offset=6');
    expect(sends[0].text).toBe('pong');
  });

  it('survives poll failures until aborted', async () => {
    const controller = new AbortController();
    let calls = 0;
    const logs: string[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      controller.abort();
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }) as typeof fetch;
    const instance = new TelegramGateway({
      token: 'T',
      sessions,
      chatSessions,
      fetchImpl,
      errorDelayMs: 1,
      write: (text) => logs.push(text),
    });
    await instance.run(controller.signal);
    expect(logs.join('')).toContain('poll failed: network down');
  });
});

describe('gateway guards', () => {
  it('rejects non-pre-authorizable policies', () => {
    expect(() => gateway({ policy: ['destructive'] })).toThrow(/never pre-authorizable/);
    expect(() => gateway({ policy: ['wat'] as never })).toThrow(/unknown permission group/);
    expect(gateway({ policy: ['read', 'shell'] }).instance.policy).toEqual(['read', 'shell']);
  });

  it('splits long replies under the message limit', async () => {
    const long = Array.from({ length: 300 }, (_, index) => `line ${index} ${'x'.repeat(20)}`).join(
      '\n'
    );
    expect(chunkText(long).every((chunk) => chunk.length <= 4096)).toBe(true);
    const { instance, api } = gateway({ createLoop: () => fakeLoop([long]) });
    await instance.handleUpdate(update(1, ALLOWED, 'go'));
    expect(api.sends.length).toBeGreaterThan(1);
    expect(api.sends.map((sent) => sent.text).join('\n')).toContain('line 299');
  });
});
