import { describe, expect, it, vi } from 'vitest';
import { AgentLoop } from './loop.js';
import {
  Providers,
  type ProviderAdapter,
  type CompletionOptions,
  type ModelInfo,
} from '../provider/provider.js';
import { LareError } from '../error/error.js';
import { createUsageRecorder, estimateTokens } from '../usage/usage.js';

class FakeAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities = {
    tools: false,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };

  private failure?: Error;

  constructor(
    private chunks: string[],
    options: { fail?: Error; name?: string } = {}
  ) {
    this.chunks = chunks;
    this.name = options.name ?? 'fake';
    if (options.fail) this.failure = options.fail;
  }

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return this.chunks.join('');
  }

  async *streamComplete(_prompt: string, _options: CompletionOptions): AsyncGenerator<string> {
    if (this.failure) throw this.failure;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

function registry(adapter: ProviderAdapter): Providers {
  const providers = new Providers();
  providers.register(adapter);
  return providers;
}

const BASE = {
  provider: 'fake',
  model: 'test-model',
  maxIterations: 5,
  maxToolCalls: 5,
  tokenBudget: 1_000_000,
  durationBudget: 60_000,
};

describe('AgentLoop', () => {
  it('streams tokens to the consumer in order', async () => {
    const adapter = new FakeAdapter(['Hello ', 'streamed ', 'world!']);
    const onComplete = vi.fn();
    const loop = new AgentLoop({ ...BASE, providers: registry(adapter) }, { onComplete });

    const received: string[] = [];
    for await (const chunk of loop.run('hi')) {
      received.push(chunk);
    }

    expect(received).toEqual(['Hello ', 'streamed ', 'world!']);
    expect(onComplete).toHaveBeenCalledWith('Hello streamed world!');
    expect(loop.getHaltReason()).toBeNull();
  });

  it('halts mid-stream when the token budget is exceeded', async () => {
    const chunks = Array.from({ length: 50 }, () => 'aaaa');
    const onHalt = vi.fn();
    const onComplete = vi.fn();
    const loop = new AgentLoop(
      { ...BASE, tokenBudget: 10, providers: registry(new FakeAdapter(chunks)) },
      { onHalt, onComplete }
    );

    const received: string[] = [];
    for await (const chunk of loop.run('hi')) {
      received.push(chunk);
    }

    expect(received).toHaveLength(10);
    expect(loop.getHaltReason()).toBe('budget');
    expect(onHalt).toHaveBeenCalledWith('budget');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('halts before any provider call when maxIterations is zero', async () => {
    const adapter = new FakeAdapter(['never', 'yielded']);
    const loop = new AgentLoop({ ...BASE, maxIterations: 0, providers: registry(adapter) }, {});

    const received: string[] = [];
    for await (const chunk of loop.run('hi')) {
      received.push(chunk);
    }

    expect(received).toEqual([]);
    expect(loop.getHaltReason()).toBe('iterations');
  });

  it('halts on a zero duration budget', async () => {
    const loop = new AgentLoop(
      { ...BASE, durationBudget: 0, providers: registry(new FakeAdapter(['x'])) },
      {}
    );

    const received: string[] = [];
    for await (const chunk of loop.run('hi')) {
      received.push(chunk);
    }

    expect(received).toEqual([]);
    expect(loop.getHaltReason()).toBe('duration');
  });

  it('throws CANCELLED when the abort signal fires before the run', async () => {
    const controller = new AbortController();
    controller.abort();
    const loop = new AgentLoop(
      { ...BASE, abortSignal: controller.signal, providers: registry(new FakeAdapter(['x'])) },
      {}
    );

    await expect(async () => {
      for await (const _chunk of loop.run('hi')) {
        // drain
      }
    }).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('maps provider aborts to CANCELLED, not NETWORK_ERROR', async () => {
    const controller = new AbortController();
    const adapter = new FakeAdapter(['a', 'b'], {
      fail: new DOMException('The operation was aborted', 'AbortError'),
    });
    const loop = new AgentLoop(
      { ...BASE, abortSignal: controller.signal, providers: registry(adapter) },
      {}
    );
    controller.abort();

    await expect(async () => {
      for await (const _chunk of loop.run('hi')) {
        // drain
      }
    }).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('reports provider failures through onError and rethrows', async () => {
    const failure = new LareError('PROVIDER_UNAVAILABLE', 'endpoint down');
    const onError = vi.fn();
    const loop = new AgentLoop(
      { ...BASE, providers: registry(new FakeAdapter(['x'], { fail: failure })) },
      { onError }
    );

    await expect(async () => {
      for await (const _chunk of loop.run('hi')) {
        // drain
      }
    }).rejects.toThrow('endpoint down');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('prefers provider-reported usage and prices it', async () => {
    class ReportingAdapter extends FakeAdapter {
      override async *streamComplete(
        _prompt: string,
        options: CompletionOptions
      ): AsyncGenerator<string> {
        options.onUsage?.({ input: 1000, output: 500, cacheRead: 400 });
        yield 'done';
      }
    }
    const loop = new AgentLoop(
      { ...BASE, model: 'gpt-4o', providers: registry(new ReportingAdapter([])) },
      {}
    );

    for await (const _chunk of loop.run('hi')) {
      // drain
    }

    const usage = loop.getUsage();
    expect(usage.totalTokens.input).toBe(1000);
    expect(usage.totalTokens.output).toBe(500);
    expect(usage.totalTokens.cacheRead).toBe(400);
    expect(usage.totalCost.totalCost).toBeCloseTo(0.0125);
  });

  it('records per-turn usage with estimated tokens', async () => {
    const prompt = 'hello world!';
    const chunks = ['abcd', 'efgh'];
    const recorder = createUsageRecorder('conv-loop');
    const loop = new AgentLoop(
      { ...BASE, usageRecorder: recorder, providers: registry(new FakeAdapter(chunks)) },
      {}
    );

    for await (const _chunk of loop.run(prompt)) {
      // drain
    }

    const usage = loop.getUsage();
    const expectedOutput = estimateTokens(chunks.join(''));
    expect(usage.totalTokens.input).toBe(estimateTokens(prompt));
    expect(usage.totalTokens.output).toBe(expectedOutput);
    expect(usage.totalTokens.total).toBe(estimateTokens(prompt) + expectedOutput);
    expect(usage.conversationId).toBe('conv-loop');
    expect(usage.byModel['fake:test-model'].totalTokens.total).toBe(
      estimateTokens(prompt) + expectedOutput
    );
  });

  it('uses an injected provider registry without touching config files', async () => {
    const adapter = new FakeAdapter(['ok'], { name: 'injected' });
    const loop = new AgentLoop({ ...BASE, provider: 'injected', providers: registry(adapter) }, {});

    const received: string[] = [];
    for await (const chunk of loop.run('hi')) {
      received.push(chunk);
    }
    expect(received).toEqual(['ok']);
  });

  it('throws PROVIDER_UNAVAILABLE for an unknown provider name', async () => {
    const loop = new AgentLoop(
      { ...BASE, provider: 'missing', providers: registry(new FakeAdapter(['x'])) },
      {}
    );

    await expect(async () => {
      for await (const _chunk of loop.run('hi')) {
        // drain
      }
    }).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
