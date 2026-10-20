import { describe, expect, it, vi } from 'vitest';
import { ChatSession, type ChatEvent } from './chat.js';
import { Permissions } from '../permission/permission.js';
import { Tools } from '../tool/tool.js';
import {
  Providers,
  type CompletionOptions,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderMessage,
  type ProviderStreamEvent,
} from '../provider/provider.js';

class ScriptedAdapter implements ProviderAdapter {
  readonly name = 'fake';
  readonly capabilities = {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };

  requests: ProviderMessage[][] = [];
  prompts: string[] = [];

  constructor(private script: ProviderStreamEvent[][]) {}

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return '';
  }

  async *streamComplete(prompt: string): AsyncGenerator<string> {
    this.prompts.push(prompt);
  }

  async *streamChat(messages: ProviderMessage[]): AsyncGenerator<ProviderStreamEvent> {
    this.requests.push(messages.map((message) => ({ ...message })));
    for (const event of this.script.shift() ?? []) yield event;
  }
}

class TranscriptAdapter implements ProviderAdapter {
  readonly name = 'fake';
  readonly capabilities = {
    tools: false,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
  };

  prompts: string[] = [];

  async models(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<string> {
    return '';
  }

  async *streamComplete(prompt: string): AsyncGenerator<string> {
    this.prompts.push(prompt);
  }
}

function registry(adapter: ProviderAdapter): Providers {
  const providers = new Providers();
  providers.register(adapter);
  return providers;
}

function toolsWith(execute: (args: unknown) => Promise<unknown>): Tools {
  const tools = new Tools();
  tools.register({
    name: 'echo',
    description: 'echo args',
    schema: { type: 'object', properties: {}, required: [] },
    execute,
  });
  return tools;
}

function session(
  adapter: ProviderAdapter,
  options: { tools?: Tools; permissions?: Permissions; agent?: 'plan' | 'build' } = {}
): ChatSession {
  return new ChatSession({
    provider: 'fake',
    model: 'test-model',
    providers: registry(adapter),
    tools: options.tools ?? toolsWith(async (args) => ({ echoed: args })),
    permissions: options.permissions ?? new Permissions({ mode: 'allow', allowedGroups: [] }),
    agent: options.agent ?? 'build',
  });
}

async function drain(instance: ChatSession, prompt: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of instance.run(prompt, { signal: new AbortController().signal })) {
    events.push(event);
  }
  return events;
}

describe('ChatSession', () => {
  it('switches model on a known provider and rejects unknown providers', () => {
    const instance = session(new ScriptedAdapter([]));
    instance.selectModel('fake', 'next-model');
    expect(instance.getProvider()).toBe('fake');
    expect(instance.getModel()).toBe('next-model');
    expect(() => instance.selectModel('missing', 'm')).toThrow(
      'Provider "missing" is not available'
    );
  });

  it('streams text, runs tools, and keeps the tool result in history', async () => {
    const adapter = new ScriptedAdapter([
      [
        { type: 'text', text: 'checking ' },
        {
          type: 'tool_calls',
          calls: [{ id: 'c1', name: 'echo', arguments: '{"x":1}' }],
        },
      ],
      [{ type: 'text', text: 'done' }],
    ]);
    const execute = vi.fn(async (args: unknown) => ({ echoed: args }));
    const instance = session(adapter, { tools: toolsWith(execute) });

    const events = await drain(instance, 'go');

    expect(events.map((event) => event.type)).toEqual(['text', 'tool_start', 'tool_end', 'text']);
    expect(execute).toHaveBeenCalledWith({ x: 1 }, expect.anything());
    const history = instance.getHistory();
    expect(history[2]?.toolCalls?.[0]?.name).toBe('echo');
    expect(history[3]).toMatchObject({ role: 'tool', toolCallId: 'c1' });
    expect(adapter.requests[1]?.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1' });
  });

  it('denies a tool that needs confirmation when no prompt is available', async () => {
    const adapter = new ScriptedAdapter([
      [{ type: 'tool_calls', calls: [{ id: 'c1', name: 'echo', arguments: '{}' }] }],
      [{ type: 'text', text: 'ok' }],
    ]);
    const execute = vi.fn(async () => 'ran');
    const instance = session(adapter, {
      tools: toolsWith(execute),
      permissions: new Permissions({ mode: 'ask', allowedGroups: ['read'] }),
    });

    const events = await drain(instance, 'go');

    expect(execute).not.toHaveBeenCalled();
    const end = events.find((event) => event.type === 'tool_end');
    expect(end).toMatchObject({ ok: false });
    expect(instance.getHistory().at(-2)?.content).toContain('PERMISSION_DENIED');
  });

  it('runs the tool once the user confirms', async () => {
    const adapter = new ScriptedAdapter([
      [{ type: 'tool_calls', calls: [{ id: 'c1', name: 'echo', arguments: '{}' }] }],
      [{ type: 'text', text: 'ok' }],
    ]);
    const execute = vi.fn(async () => 'ran');
    const confirm = vi.fn(async () => true);
    const instance = session(adapter, {
      tools: toolsWith(execute),
      permissions: new Permissions({ mode: 'ask', allowedGroups: ['read'] }),
    });

    const events: ChatEvent[] = [];
    for await (const event of instance.run('go', {
      signal: new AbortController().signal,
      confirm,
    })) {
      events.push(event);
    }

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'echo', group: 'write' }));
    expect(execute).toHaveBeenCalled();
    expect(events.find((event) => event.type === 'tool_end')).toMatchObject({ ok: true });
  });

  it('falls back to a transcript prompt for adapters without streamChat', async () => {
    const adapter = new TranscriptAdapter();
    const instance = session(adapter);

    await drain(instance, 'hello');
    await drain(instance, 'again');

    expect(adapter.prompts[0]).toContain('user: hello');
    expect(adapter.prompts[1]).toContain('user: hello');
  });

  it('clears conversation history on reset', async () => {
    const adapter = new ScriptedAdapter([[{ type: 'text', text: 'hi' }]]);
    const instance = session(adapter);

    await drain(instance, 'hello');
    expect(instance.getHistory()).toHaveLength(3);
    instance.reset();
    expect(instance.getHistory()).toHaveLength(1);
    expect(instance.getHistory()[0]?.role).toBe('system');
  });
});
