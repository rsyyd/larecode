import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LareError } from '../error/error.js';
import { Permissions } from '../permission/permission.js';
import {
  Providers,
  type CompletionOptions,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderMessage,
  type ProviderStreamEvent,
} from '../provider/provider.js';
import { Tools } from '../tool/tool.js';
import type { UsageAggregate } from '../usage/usage.js';
import {
  DefaultAgentRuntime,
  isAgentRuntimeStopEvent,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeTurnInput,
} from './runtime.js';

function usage(): UsageAggregate {
  return {
    totalTokens: { input: 1, output: 1, total: 2 },
    totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    byModel: {},
    conversationId: 's1',
    startedAt: 0,
    updatedAt: 0,
  };
}

class TextAdapter implements ProviderAdapter {
  readonly name: string = 'fake';
  readonly seen: ProviderMessage[][] = [];
  readonly capabilities = {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return 'hi';
  }

  async *streamComplete(): AsyncGenerator<string> {}

  async *streamChat(messages: ProviderMessage[]): AsyncGenerator<ProviderStreamEvent> {
    this.seen.push(messages.map((message) => ({ ...message })));
    yield { type: 'text', text: 'hi' };
  }
}

class SpecAdapter extends TextAdapter {
  seenSpecs: string[] = [];

  override async *streamChat(
    messages: ProviderMessage[],
    options?: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    this.seenSpecs = (options?.tools ?? []).map((tool) => tool.name);
    yield { type: 'text', text: 'hi' };
  }
}

class CompactAdapter extends TextAdapter {
  readonly requests: ProviderMessage[][] = [];
  summaries = 0;

  override async complete(): Promise<string> {
    this.summaries += 1;
    return 'condensed history';
  }

  override async *streamChat(
    messages: ProviderMessage[],
    _options?: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    this.requests.push(messages.map((message) => ({ ...message })));
    yield { type: 'text', text: 'done' };
  }
}

class EmptyAdapter extends TextAdapter {
  override async *streamChat(): AsyncGenerator<ProviderStreamEvent> {}
}

class FlakyAdapter extends TextAdapter {
  attempts = 0;

  override async *streamChat(messages: ProviderMessage[]): AsyncGenerator<ProviderStreamEvent> {
    this.attempts += 1;
    if (this.attempts < 3) {
      throw new LareError('RATE_LIMITED', 'slow down', { retryable: true });
    }
    yield { type: 'text', text: 'ok' };
  }
}

class PartialAdapter extends TextAdapter {
  attempts = 0;

  override async *streamChat(): AsyncGenerator<ProviderStreamEvent> {
    this.attempts += 1;
    yield { type: 'text', text: 'partial' };
    throw new LareError('RATE_LIMITED', 'lost the stream', { retryable: true });
  }
}

class HangingAdapter extends TextAdapter {
  attempts = 0;

  override async *streamChat(
    _messages: ProviderMessage[],
    options?: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    this.attempts += 1;
    await new Promise<void>((_resolve, reject) => {
      options?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
    yield { type: 'text', text: 'late' };
  }
}

function runtime(events: AgentRuntimeEvent[], seen: AgentRuntimeTurnInput[] = []): AgentRuntime {
  return {
    sessionId: 's1',
    getProvider: () => 'fake',
    getModel: () => 'test-model',
    getUsage: () => usage(),
    getHistory: () => [],
    getContextReport: () => ({
      enabled: false,
      used: 0,
      total: 0,
      sections: [],
      sources: { instructions: [], repoMap: false, retrievalFiles: 0, memoryEntries: 0 },
      text: '',
    }),
    setAgent: () => {},
    selectModel: () => {},
    reset: () => {},
    async *run(input) {
      seen.push(input);
      for (const event of events) yield event;
    },
  };
}

describe('AgentRuntime contract', () => {
  it('compacts old history and keeps recent tool calls intact', async () => {
    const adapter = new CompactAdapter();
    const providers = new Providers();
    providers.register(adapter);
    const history: ProviderMessage[] = [];
    for (let index = 0; index < 8; index += 1) {
      history.push({ role: 'user', content: `question ${index} ${'q'.repeat(400)}` });
      history.push({ role: 'assistant', content: `answer ${index} ${'a'.repeat(400)}` });
    }
    history.push({ role: 'tool', content: 'tool payload', toolCallId: 'call-1' });

    const runtime = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      agent: 'plan',
      history,
      compactAtTokens: 300,
      compactKeepRecent: 4,
    });

    for await (const _event of runtime.run({
      prompt: 'new question',
      signal: new AbortController().signal,
    })) {
      // drain
    }

    expect(adapter.summaries).toBe(1);
    expect(adapter.requests).toHaveLength(1);
    const sent = adapter.requests[0] ?? [];
    expect(sent[0]?.role).toBe('system');
    expect(sent[0]?.content).toContain('Working directory');
    expect(sent[1]?.content).toContain('[compacted summary]');
    expect(sent[1]?.content).toContain('condensed history');
    expect(sent.at(-1)?.content).toBe('new question');
    expect(sent.some((message) => message.toolCallId === 'call-1')).toBe(true);
  });

  it('registers lsp, task, and skill tools by default', async () => {
    const adapter = new SpecAdapter();
    const providers = new Providers();
    providers.register(adapter);
    const cwd = mkdtempSync(join(tmpdir(), 'lare-runtime-tools-'));
    const runtime = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      agent: 'plan',
      workingDir: cwd,
    });

    const controller = new AbortController();
    for await (const _event of runtime.run({ prompt: 'hi', signal: controller.signal })) {
      // drain
    }

    expect(adapter.seenSpecs).toEqual(expect.arrayContaining(['read', 'lsp', 'task', 'skill']));
    expect(adapter.seenSpecs).not.toContain('write');
    rmSync(cwd, { recursive: true, force: true });
  });

  it('falls back to a configured provider when the primary fails', async () => {
    class AuthFails extends TextAdapter {
      override async *streamChat(): AsyncGenerator<ProviderStreamEvent> {
        throw new LareError('PROVIDER_AUTH_FAILED', 'bad key');
      }
    }
    class BackupAdapter extends TextAdapter {
      override readonly name = 'backup';
    }
    const primary = new AuthFails();
    const backup = new BackupAdapter();
    const providers = new Providers();
    providers.register(primary);
    providers.register(backup);
    const runtime = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      fallbacks: [{ provider: 'backup', model: 'test-model' }],
    });

    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.run({
      prompt: 'hi',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(runtime.getProvider()).toBe('backup');
    expect(events).toContainEqual({
      type: 'fallback',
      from: 'fake',
      provider: 'backup',
      model: 'test-model',
      reason: 'provider error',
    });
    expect(events.some((event) => event.type === 'text')).toBe(true);
  });

  it('streams events and forwards the turn signal', async () => {
    const controller = new AbortController();
    const seen: AgentRuntimeTurnInput[] = [];
    const events: AgentRuntimeEvent[] = [
      { type: 'text', text: 'hi' },
      { type: 'tool_start', callId: 'c1', name: 'read', args: { path: 'a' } },
      { type: 'tool_end', callId: 'c1', name: 'read', ok: true, output: 'a' },
      { type: 'usage', usage: usage() },
      { type: 'halt', reason: 'completed' },
    ];
    const collected: AgentRuntimeEvent[] = [];

    for await (const event of runtime(events, seen).run({
      prompt: 'hello',
      signal: controller.signal,
    })) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it('runs a turn through the default runtime', async () => {
    const providers = new Providers();
    providers.register(new TextAdapter());
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of instance.run({
      prompt: 'hello',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['text', 'usage', 'halt']);
    expect(events.at(-1)).toMatchObject({ type: 'halt', reason: 'completed' });
  });

  it('reports an empty provider response instead of completing silently', async () => {
    const providers = new Providers();
    providers.register(new EmptyAdapter());
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of instance.run({
      prompt: 'hello',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'EMPTY_RESPONSE', retryable: true },
    });
    expect(instance.getHistory()).toHaveLength(2);
  });

  it('replays supplied history before the new prompt', async () => {
    const adapter = new TextAdapter();
    const providers = new Providers();
    providers.register(adapter);
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
      history: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
      ],
    });

    for await (const _event of instance.run({
      prompt: 'follow up',
      signal: new AbortController().signal,
    })) {
      // drain
    }

    expect(adapter.seen[0]?.slice(1)).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'follow up' },
    ]);
  });

  it('retries retryable stream failures before any text', async () => {
    const adapter = new FlakyAdapter();
    const providers = new Providers();
    providers.register(adapter);
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
      maxRetries: 2,
      retryDelayMs: 0,
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of instance.run({
      prompt: 'hello',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(adapter.attempts).toBe(3);
    expect(
      events
        .filter((event) => event.type === 'text')
        .map((event) => (event.type === 'text' ? event.text : ''))
    ).toEqual(['ok']);
    expect(events.at(-1)).toMatchObject({ type: 'halt', reason: 'completed' });
  });

  it('does not retry once text has been emitted', async () => {
    const adapter = new PartialAdapter();
    const providers = new Providers();
    providers.register(adapter);
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
      maxRetries: 2,
      retryDelayMs: 0,
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of instance.run({
      prompt: 'hello',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(adapter.attempts).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('reports a per-request timeout without retrying', async () => {
    const adapter = new HangingAdapter();
    const providers = new Providers();
    providers.register(adapter);
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
      maxRetries: 2,
      retryDelayMs: 0,
      requestTimeoutMs: 20,
    });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of instance.run({
      prompt: 'hello',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(adapter.attempts).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'PROVIDER_TIMEOUT' },
    });
  });

  it('halts with cancelled when the turn signal is aborted', async () => {
    const providers = new Providers();
    providers.register(new TextAdapter());
    const instance = new DefaultAgentRuntime({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
    });
    const controller = new AbortController();
    controller.abort();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of instance.run({ prompt: 'hello', signal: controller.signal })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: 'halt', reason: 'cancelled' }]);
  });

  it('treats halt and error as terminal events', () => {
    const events: AgentRuntimeEvent[] = [
      { type: 'text', text: 'x' },
      { type: 'tool_start', callId: 'c1', name: 'read', args: {} },
      { type: 'tool_end', callId: 'c1', name: 'read', ok: true, output: '' },
      { type: 'usage', usage: usage() },
      { type: 'halt', reason: 'budget' },
      {
        type: 'error',
        error: {
          name: 'LareError',
          code: 'NETWORK_ERROR',
          category: 'network',
          message: 'down',
          retryable: true,
          context: {},
        },
      },
    ];

    expect(events.map(isAgentRuntimeStopEvent)).toEqual([false, false, false, false, true, true]);
  });
});
