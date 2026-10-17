import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../config/config.js';
import { OpenAIAdapter, openAIAdapterFromConfig, providersFromConfig } from './openai-adapter.js';
import { Providers } from './provider.js';

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    adapter = new OpenAIAdapter({
      name: 'openai-compatible',
      baseUrl: 'http://localhost:20128/v1',
      apiKey: 'test-key',
      models: ['gpt-4o', 'gpt-4o-mini'],
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
  });

  it('models() returns parsed list or falls back to configured catalog', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-4o' }, { id: 'custom-model' }],
      }),
    });

    const models = await adapter.models();
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'custom-model']);

    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const fallback = await adapter.models();
    expect(fallback.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('complete() posts to chat/completions and returns text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ text: 'response text' }],
      }),
    });

    const text = await adapter.complete('hello', { model: 'gpt-4o' });
    expect(text).toBe('response text');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:20128/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
      })
    );
  });

  it('streamComplete() streams parsed chunks until done', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"text":"part1"}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"text":"part2"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const parts: string[] = [];
    for await (const chunk of adapter.streamComplete('stream this', { model: 'gpt-4o' })) {
      parts.push(chunk);
    }
    expect(parts).toEqual(['part1', 'part2']);
  });

  it('swaps model seamlessly between requests', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ text: 'from gpt-4o' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ text: 'from mini' }] }),
      });

    const r1 = await adapter.complete('hi', { model: 'gpt-4o' });
    const r2 = await adapter.complete('hi', { model: 'gpt-4o-mini' });

    expect(r1).toBe('from gpt-4o');
    expect(r2).toBe('from mini');
  });

  it('throws mapped LumpsError on auth failures', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(adapter.complete('hi', { model: 'gpt-4o' })).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
    });
  });
});

describe('Providers registry', () => {
  it('registers and gets adapters', () => {
    const providers = new Providers();
    const adapter = new OpenAIAdapter({
      name: 'local',
      baseUrl: 'http://localhost:11434/v1',
      models: ['llama3'],
    });

    providers.register(adapter);
    expect(providers.get('local')).toBe(adapter);
    expect(providers.list()).toHaveLength(1);
  });

  it('creates an adapter from config helper', () => {
    const config: ProviderConfig = {
      type: 'openai-compatible',
      baseUrl: 'http://localhost:8000',
      apiKey: 'k',
      models: ['m1'],
    };

    const adapter = openAIAdapterFromConfig('custom', config);
    expect(adapter.name).toBe('custom');
  });

  it('loads supported providers from config', () => {
    const providers = providersFromConfig({
      version: '0.0.0',
      defaultProvider: 'p1',
      defaultModel: 'm1',
      permissions: { mode: 'ask', allowedGroups: [] },
      providers: {
        p1: { type: 'openai-compatible', baseUrl: 'http://test', models: ['m1'] },
        p2: { type: 'ollama', baseUrl: 'http://test2', models: ['m2'] },
      },
    });

    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('p1');
  });
});
