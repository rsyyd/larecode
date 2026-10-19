import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentLoop,
  Providers,
  Sessions,
  LareError,
  type CompletionOptions,
  type ModelInfo,
  type ProviderAdapter,
} from '@larecode/core';
import { LareClient } from './client.js';

class FakeAdapter implements ProviderAdapter {
  readonly name = 'fake';
  readonly capabilities = {
    tools: false,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };

  constructor(private readonly chunks: string[]) {}

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return this.chunks.join('');
  }

  async *streamComplete(_prompt: string, options: CompletionOptions): AsyncGenerator<string> {
    options.onUsage?.({ input: 100, output: 25, cacheRead: 40 });
    for (const chunk of this.chunks) yield chunk;
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-sdk-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function client(chunks: string[], overrides: { sessions?: Sessions } = {}): LareClient {
  const providers = new Providers();
  providers.register(new FakeAdapter(chunks));
  return new LareClient({
    provider: 'fake',
    model: 'test-model',
    sessions: overrides.sessions ?? new Sessions(join(dir, 'sessions')),
    loopFactory: (options) => new AgentLoop({ ...options, providers }),
  });
}

describe('LareClient', () => {
  it('drives core end to end: streams, records usage, and persists the session', async () => {
    const sessions = new Sessions(join(dir, 'sessions'));
    const sdk = client(['Hello ', 'from ', 'core'], { sessions });

    const chunks: string[] = [];
    const result = await sdk.run('write a greeting', { onChunk: (chunk) => chunks.push(chunk) });

    expect(chunks).toEqual(['Hello ', 'from ', 'core']);
    expect(result.text).toBe('Hello from core');
    expect(result.stopReason).toBe('end_turn');
    expect(result.halt).toBeNull();
    expect(result.usage.totalTokens).toMatchObject({ input: 100, output: 25, cacheRead: 40 });

    const stored = sessions.get(result.sessionId);
    expect(stored?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(stored?.messages[0].content).toBe('write a greeting');
    expect(stored?.messages[1].content).toBe('Hello from core');
    expect(stored?.metadata.tokenUsage).toBe(result.usage.totalTokens.total);
    expect(sessions.list().map((meta) => meta.id)).toContain(result.sessionId);
  });

  it('continues an existing session with its history in place', async () => {
    const sessions = new Sessions(join(dir, 'sessions'));
    const sdk = client(['first'], { sessions });
    const first = await sdk.run('one');

    const second = await sdk.run('two', { sessionId: first.sessionId });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.usage.totalTokens.total).toBeGreaterThan(0);

    const stored = sessions.get(first.sessionId);
    expect(stored?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('reports cancellation when the caller aborts', async () => {
    const sdk = client(['never delivered']);
    const controller = new AbortController();
    controller.abort();
    const result = await sdk.run('hello', { signal: controller.signal });
    expect(result.stopReason).toBe('cancelled');
    expect(result.text).toBe('');
  });

  it('rejects unknown session ids', async () => {
    const sdk = client(['x']);
    await expect(sdk.run('hi', { sessionId: 'missing' })).rejects.toThrow(LareError);
    await expect(sdk.run('hi', { sessionId: 'missing' })).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });
});
