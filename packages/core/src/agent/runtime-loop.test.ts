import { describe, expect, it } from 'vitest';
import { Permissions } from '../permission/permission.js';
import { Providers } from '../provider/provider.js';
import type {
  CompletionOptions,
  ModelInfo,
  ProviderAdapter,
  ProviderMessage,
  ProviderStreamEvent,
  ProviderToolCall,
  ToolSpec,
} from '../provider/provider.js';
import { Tools, type Tool } from '../tool/tool.js';
import { AgentRuntimeLoop } from './runtime-loop.js';

class ToolAdapter implements ProviderAdapter {
  readonly name = 'fake';
  readonly capabilities = {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };
  private turns = 0;

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return 'done';
  }

  async *streamComplete(): AsyncGenerator<string> {}

  async *streamChat(
    _messages: ProviderMessage[],
    options: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    this.turns += 1;
    if (this.turns === 1) {
      expect(options.tools?.map((tool: ToolSpec) => tool.name)).toContain('echo');
      yield {
        type: 'tool_calls',
        calls: [{ id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }],
      };
      return;
    }
    yield { type: 'text', text: 'done' };
  }
}

class FailingAdapter extends ToolAdapter {
  override async *streamChat(): AsyncGenerator<ProviderStreamEvent> {
    yield { type: 'text', text: '' };
    throw new Error('boom');
  }
}

class CallAdapter implements ProviderAdapter {
  readonly name = 'fake';
  readonly capabilities = {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };
  private sent = false;

  constructor(private readonly call: ProviderToolCall) {}

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return 'done';
  }

  async *streamComplete(): AsyncGenerator<string> {}

  async *streamChat(): AsyncGenerator<ProviderStreamEvent> {
    if (!this.sent) {
      this.sent = true;
      yield { type: 'tool_calls', calls: [this.call] };
      return;
    }
    yield { type: 'text', text: 'done' };
  }
}

function echoTool(seen: unknown[]): Tool {
  return {
    name: 'echo',
    description: 'echo the input',
    schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'text to echo' } },
      required: ['text'],
    },
    async execute(args) {
      seen.push(args);
      return args;
    },
  };
}

function runtimeLoop(adapter: ProviderAdapter, tools: Tools, maxIterations = 10): AgentRuntimeLoop {
  const providers = new Providers();
  providers.register(adapter);
  return new AgentRuntimeLoop({
    provider: 'fake',
    model: 'test-model',
    agent: 'build',
    providers,
    tools,
    permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
    maxIterations,
  });
}

describe('AgentRuntimeLoop', () => {
  it('runs the tool loop and returns the final text', async () => {
    const seen: unknown[] = [];
    const tools = new Tools();
    tools.register(echoTool(seen));
    const loop = runtimeLoop(new ToolAdapter(), tools);
    const chunks: string[] = [];

    for await (const chunk of loop.run('say hi')) chunks.push(chunk);

    expect(chunks).toEqual(['done']);
    expect(seen).toEqual([{ text: 'hi' }]);
    expect(loop.getHaltReason()).toBeNull();
    expect(loop.getUsage().totalTokens.total).toBeGreaterThan(0);
  });

  it('checkpoints around each tool call when enabled', async () => {
    const seen: unknown[] = [];
    const labels: string[] = [];
    const tools = new Tools();
    tools.register(echoTool(seen));
    const providers = new Providers();
    providers.register(new ToolAdapter());
    const loop = new AgentRuntimeLoop({
      provider: 'fake',
      model: 'test-model',
      agent: 'build',
      providers,
      tools,
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
      checkpoints: {
        async create(label = 'checkpoint') {
          labels.push(label);
          return label;
        },
      },
    });

    for await (const _chunk of loop.run('say hi')) {
      // drain
    }

    expect(seen).toEqual([{ text: 'hi' }]);
    expect(labels).toEqual(['pre-tool echo', 'post-tool echo']);
  });

  it('honors unattended pre-authorization', async () => {
    const seen: unknown[] = [];
    const tools = new Tools();
    tools.register(echoTool(seen));
    const providers = new Providers();
    providers.register(new ToolAdapter());
    const loop = new AgentRuntimeLoop({
      provider: 'fake',
      model: 'test-model',
      agent: 'build',
      providers,
      tools,
      permissions: new Permissions({
        mode: 'ask',
        allowedGroups: [],
        preAuthorized: { cron: ['write'] },
      }),
      unattended: true,
    });

    for await (const _chunk of loop.run('say hi')) {
      // drain
    }

    expect(seen).toEqual([{ text: 'hi' }]);
  });

  it('rejects malformed tool calls before execution', async () => {
    const cases: ProviderToolCall[] = [
      { id: 'c1', name: 'echo', arguments: '{' },
      { id: 'c2', name: 'echo', arguments: '{}' },
      { id: 'c3', name: 'echo', arguments: '{"text":1}' },
      { id: 'c4', name: 'missing', arguments: '{}' },
    ];

    for (const call of cases) {
      const seen: unknown[] = [];
      const tools = new Tools();
      tools.register(echoTool(seen));
      const chunks: string[] = [];

      for await (const chunk of runtimeLoop(new CallAdapter(call), tools).run('go')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['done']);
      expect(seen).toEqual([]);
    }
  });

  it('reports iteration halts', async () => {
    const loop = runtimeLoop(new ToolAdapter(), new Tools(), 0);

    for await (const _chunk of loop.run('go')) {
      // drain
    }

    expect(loop.getHaltReason()).toBe('iterations');
  });

  it('throws runtime errors', async () => {
    const loop = runtimeLoop(new FailingAdapter(), new Tools());

    await expect(
      (async () => {
        for await (const _chunk of loop.run('go')) {
          // drain
        }
      })()
    ).rejects.toMatchObject({ code: 'UNKNOWN', message: 'boom' });
  });

  it('throws when the turn is cancelled', async () => {
    const providers = new Providers();
    providers.register(new ToolAdapter());
    const controller = new AbortController();
    controller.abort();
    const loop = new AgentRuntimeLoop({
      provider: 'fake',
      model: 'test-model',
      providers,
      tools: new Tools(),
      permissions: new Permissions({ mode: 'allow', allowedGroups: [] }),
      abortSignal: controller.signal,
    });

    await expect(
      (async () => {
        for await (const _chunk of loop.run('go')) {
          // drain
        }
      })()
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
