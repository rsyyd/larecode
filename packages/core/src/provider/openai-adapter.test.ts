import { describe, expect, it, vi } from 'vitest';
import type { Config, ProviderConfig } from '../config/config.js';
import { OpenAIAdapter, openAIAdapterFromConfig } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { providersFromConfig, Providers } from './provider.js';
import type { LareCodeFetch } from './fetch.js';

function okJson(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response;
}

function rawStream(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

describe('OpenAIAdapter specifics', () => {
  it('sends bearer auth and openrouter attribution headers per config type', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(_url), init });
      return okJson({ choices: [{ message: { content: 'hi' } }] });
    }) as LareCodeFetch;

    const plain = openAIAdapterFromConfig(
      'p1',
      {
        type: 'openai-compatible',
        baseUrl: 'http://mock/v1',
        apiKey: 'k',
        models: ['m'],
      },
      fetchImpl
    );
    await plain.complete('hi', { model: 'm' });
    const plainHeaders = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(plainHeaders.authorization).toBe('Bearer k');
    expect(plainHeaders['HTTP-Referer']).toBeUndefined();

    calls.length = 0;
    const router = openAIAdapterFromConfig(
      'p2',
      {
        type: 'openrouter',
        baseUrl: 'http://mock/v1',
        apiKey: 'k',
        models: ['m'],
      },
      fetchImpl
    );
    await router.complete('hi', { model: 'm' });
    const routerHeaders = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(routerHeaders['HTTP-Referer']).toBe('https://github.com/rsyyd/larecode');
    expect(routerHeaders['X-Title']).toBe('larecode');
    expect(router.capabilities.vision).toBe(true);
  });

  it('swaps model on a live adapter instance', async () => {
    const mockFn = vi
      .fn()
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'from a' } }] }))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'from b' } }] }));
    const fetchImpl = mockFn as unknown as LareCodeFetch;

    const adapter = new OpenAIAdapter({
      name: 't',
      baseUrl: 'http://mock/v1',
      models: ['a', 'b'],
      fetchImpl,
    });

    expect(await adapter.complete('hi', { model: 'a' })).toBe('from a');
    expect(await adapter.complete('hi', { model: 'b' })).toBe('from b');

    const first = JSON.parse(String(mockFn.mock.calls[0][1]?.body));
    const second = JSON.parse(String(mockFn.mock.calls[1][1]?.body));
    expect(first.model).toBe('a');
    expect(second.model).toBe('b');
  });
});

describe('providersFromConfig mapping', () => {
  it('instantiates the right adapter class per provider type', () => {
    const config = {
      version: '0.0.0',
      defaultProvider: 'p1',
      defaultModel: 'm',
      permissions: { mode: 'ask' as const, allowedGroups: [] },
      providers: {
        p1: { type: 'openai-compatible', baseUrl: 'http://a', models: ['m'] },
        p2: { type: 'anthropic', baseUrl: 'http://b', apiKey: 'k', models: ['m'] },
        p3: { type: 'ollama', baseUrl: 'http://c', models: ['m'] },
        p4: { type: 'zai', baseUrl: 'http://d', apiKey: 'k', models: ['m'] },
        p5: { type: 'openrouter', baseUrl: 'http://e', apiKey: 'k', models: ['m'] },
        p6: { type: 'custom', baseUrl: 'http://f', models: ['m'] },
      },
      mcpServers: {},
    } satisfies Config;

    const adapters = providersFromConfig(config);
    expect(adapters).toHaveLength(6);
    expect(adapters[0]).toBeInstanceOf(OpenAIAdapter);
    expect(adapters[1]).toBeInstanceOf(AnthropicAdapter);
    expect(adapters[2]).toBeInstanceOf(OllamaAdapter);
    expect(adapters[3]).toBeInstanceOf(OpenAIAdapter);
    expect(adapters[4]).toBeInstanceOf(OpenAIAdapter);
    expect(adapters[5]).toBeInstanceOf(OpenAIAdapter);
    expect(adapters[3].capabilities.reasoning).toBe(true);
  });
});

describe('Providers registry', () => {
  it('registers, gets, and lists adapters', () => {
    const providers = new Providers();
    const adapter = openAIAdapterFromConfig('local', {
      type: 'openai-compatible',
      baseUrl: 'http://x',
      models: ['m'],
    } satisfies ProviderConfig);

    providers.register(adapter);
    expect(providers.get('local')).toBe(adapter);
    expect(providers.list()).toHaveLength(1);
    expect(providers.get('missing')).toBeUndefined();
  });
});

describe('OpenAIAdapter streamChat', () => {
  it('streams text and assembles fragmented tool calls', async () => {
    const body =
      [
        'data: {"choices":[{"delta":{"content":"checking "}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"pa"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
        'data: [DONE]',
        '',
      ].join('\n\n') + '\n\n';

    const fetchImpl = (async () => rawStream(body)) as LareCodeFetch;
    const adapter = new OpenAIAdapter({
      name: 'mock',
      baseUrl: 'http://mock/v1',
      models: ['m'],
      fetchImpl,
    });

    const events = [];
    for await (const event of adapter.streamChat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'go' },
      ],
      { model: 'm' }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'checking ' },
      { type: 'usage', usage: { input: 10, output: 5 } },
      {
        type: 'tool_calls',
        calls: [{ id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
    ]);
  });
});
