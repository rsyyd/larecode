import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sessions } from '@larecode/core';
import { AcpAgent, type AcpStopReason, type AcpTurnContext } from './acp.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-acp-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Sent {
  id?: number | string | null;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  params?: {
    sessionId?: string;
    update?: { sessionUpdate?: string; content?: { type?: string; text?: string } };
  };
}

function harness(turn?: (prompt: string, context: AcpTurnContext) => Promise<AcpStopReason>) {
  const out: Sent[] = [];
  const agent = new AcpAgent({
    version: '9.9.9',
    sessions: new Sessions(join(dir, 'sessions')),
    send: (message) => out.push(message as Sent),
    ...(turn ? { runTurn: turn } : {}),
  });
  const line = (payload: unknown) =>
    agent.handleLine(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const initialize = () =>
    line({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
  const newSession = async (): Promise<string> => {
    await line({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { cwd: dir, mcpServers: [] },
    });
    const result = out.at(-1)?.result as { sessionId?: string } | undefined;
    if (!result?.sessionId) throw new Error('session/new did not return a session id');
    return result.sessionId;
  };
  const prompt = (sessionId: string, text: string, id = 2) =>
    line({
      jsonrpc: '2.0',
      id,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text }] },
    });
  return { agent, out, line, initialize, newSession, prompt };
}

describe('AcpAgent', () => {
  it('negotiates the protocol version and advertises the agent', async () => {
    const { out, initialize } = harness();
    await initialize();
    const response = out[0];
    expect(response.id).toBe(0);
    expect(response.result?.protocolVersion).toBe(1);
    expect(response.result?.agentInfo).toMatchObject({ name: 'larecode', version: '9.9.9' });
    expect(response.result?.agentCapabilities).toMatchObject({ loadSession: false });
    expect(response.result?.authMethods).toEqual([]);
  });

  it('creates sessions and streams prompt output as session updates', async () => {
    const { out, initialize, newSession, prompt } = harness(async (_prompt, context) => {
      context.onChunk('Hello ');
      context.onChunk('Zed');
      return 'end_turn';
    });
    await initialize();
    const sessionId = await newSession();

    await prompt(sessionId, 'hi');

    const updates = out.filter((message) => message.method === 'session/update');
    expect(updates.map((message) => message.params?.update?.content?.text)).toEqual([
      'Hello ',
      'Zed',
    ]);
    expect(updates[0]?.params?.update?.sessionUpdate).toBe('agent_message_chunk');
    expect(updates[0]?.params?.sessionId).toBe(sessionId);
    expect(out.at(-1)?.id).toBe(2);
    expect(out.at(-1)?.result).toEqual({ stopReason: 'end_turn' });
  });

  it('joins multiple text blocks into one prompt', async () => {
    let seen = '';
    const { initialize, newSession, line } = harness(async (promptText) => {
      seen = promptText;
      return 'end_turn';
    });
    await initialize();
    const sessionId = await newSession();
    await line({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [
          { type: 'text', text: 'first' },
          { type: 'resource_link', uri: 'file:///x' },
          { type: 'text', text: 'second' },
        ],
      },
    });
    expect(seen).toBe('first\nsecond');
  });

  it('maps budget halts to max_tokens', async () => {
    const { out, initialize, newSession, prompt } = harness(async () => 'max_tokens');
    await initialize();
    await prompt(await newSession(), 'go');
    expect(out.at(-1)?.result).toEqual({ stopReason: 'max_tokens' });
  });

  it('cancels the running turn on session/cancel', async () => {
    const { out, initialize, newSession, prompt, line } = harness(
      (promptText, context) =>
        new Promise((resolve) => {
          context.signal.addEventListener('abort', () => resolve('cancelled'));
          if (promptText === 'never') resolve('cancelled');
        })
    );
    await initialize();
    const sessionId = await newSession();

    const pending = prompt(sessionId, 'long task');
    await line({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    await pending;

    expect(out.at(-1)?.result).toEqual({ stopReason: 'cancelled' });
  });

  it('reports protocol errors without crashing the connection', async () => {
    const { out, initialize, line, prompt } = harness();
    await initialize();

    await line('{not json');
    expect(out.at(-1)?.error?.code).toBe(-32700);

    await line({ jsonrpc: '2.0', id: 7, method: 'session/load', params: {} });
    expect(out.at(-1)?.error?.code).toBe(-32601);

    await prompt('missing-session', 'hi');
    expect(out.at(-1)?.error?.code).toBe(-32004);

    await initialize();
    expect(out.at(-1)?.result?.protocolVersion).toBe(1);
  });

  it('ignores notifications and empty lines', async () => {
    const { out, line } = harness();
    const before = out.length;
    await line('');
    await line(JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: {} }));
    expect(out.length).toBe(before);
  });
});
