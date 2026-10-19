import { describe, expect, it } from 'vitest';
import type { LumpsCodeFetch } from './fetch.js';
import type { ProviderUsage } from './provider.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';

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

function collector() {
  const seen: ProviderUsage[] = [];
  return { seen, onUsage: (usage: ProviderUsage) => seen.push(usage) };
}

const openai = (response: Response, requests: unknown[] = []) =>
  new OpenAIAdapter({
    name: 'openai',
    baseUrl: 'http://mock/v1',
    models: ['gpt-4o'],
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return response;
    }) as LumpsCodeFetch,
  });

describe('provider usage reporting', () => {
  it('reports openai-compatible usage from complete', async () => {
    const { seen, onUsage } = collector();
    const adapter = openai(
      okJson({
        choices: [{ message: { content: 'hi' } }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          prompt_tokens_details: { cached_tokens: 800 },
        },
      })
    );
    await adapter.complete('hello', { model: 'gpt-4o', onUsage });
    expect(seen).toEqual([{ input: 1200, output: 300, cacheRead: 800 }]);
  });

  it('reports openai-compatible usage from the final stream chunk and asks for it', async () => {
    const requests: unknown[] = [];
    const { seen, onUsage } = collector();
    const adapter = openai(
      rawStream(
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
          'data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":100}}\n\n' +
          'data: [DONE]\n\n'
      ),
      requests
    );
    let text = '';
    for await (const chunk of adapter.streamComplete('hello', { model: 'gpt-4o', onUsage })) {
      text += chunk;
    }
    expect(text).toBe('hi');
    expect(seen).toEqual([{ input: 900, output: 100 }]);
    expect((requests[0] as { stream_options?: unknown }).stream_options).toEqual({
      include_usage: true,
    });
  });

  it('leaves stream_options alone when no usage listener is attached', async () => {
    const requests: unknown[] = [];
    const adapter = openai(rawStream('data: [DONE]\n\n'), requests);
    for await (const _chunk of adapter.streamComplete('hello', { model: 'gpt-4o' })) {
      // drained
    }
    expect((requests[0] as { stream_options?: unknown }).stream_options).toBeUndefined();
  });

  it('reports anthropic usage including cache reads across stream events', async () => {
    const { seen, onUsage } = collector();
    const adapter = new AnthropicAdapter({
      name: 'anthropic',
      baseUrl: 'http://mock',
      apiKey: 'k',
      models: ['claude-3-5-sonnet'],
      fetchImpl: (async () =>
        rawStream(
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":500,"output_tokens":1,"cache_read_input_tokens":400}}}\n\n' +
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hey"}}\n\n' +
            'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}\n\n' +
            'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        )) as LumpsCodeFetch,
    });
    let text = '';
    for await (const chunk of adapter.streamComplete('hello', {
      model: 'claude-3-5-sonnet',
      onUsage,
    })) {
      text += chunk;
    }
    expect(text).toBe('hey');
    expect(seen).toEqual([{ input: 500, output: 42, cacheRead: 400 }]);
  });

  it('reports anthropic usage from complete', async () => {
    const { seen, onUsage } = collector();
    const adapter = new AnthropicAdapter({
      name: 'anthropic',
      baseUrl: 'http://mock',
      apiKey: 'k',
      models: ['claude-3-5-sonnet'],
      fetchImpl: (async () =>
        okJson({
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 300, output_tokens: 50, cache_read_input_tokens: 200 },
        })) as LumpsCodeFetch,
    });
    await adapter.complete('hello', { model: 'claude-3-5-sonnet', onUsage });
    expect(seen).toEqual([{ input: 300, output: 50, cacheRead: 200 }]);
  });

  it('reports ollama usage from the terminal stream chunk', async () => {
    const { seen, onUsage } = collector();
    const adapter = new OllamaAdapter({
      name: 'ollama',
      baseUrl: 'http://mock',
      models: ['llama3'],
      fetchImpl: (async () =>
        rawStream(
          '{"message":{"content":"hi"},"done":false}\n' +
            '{"message":{"content":""},"done":true,"prompt_eval_count":64,"eval_count":16}\n'
        )) as LumpsCodeFetch,
    });
    let text = '';
    for await (const chunk of adapter.streamComplete('hello', { model: 'llama3', onUsage })) {
      text += chunk;
    }
    expect(text).toBe('hi');
    expect(seen).toEqual([{ input: 64, output: 16 }]);
  });

  it('stays silent when the provider omits usage', async () => {
    const { seen, onUsage } = collector();
    const adapter = openai(okJson({ choices: [{ message: { content: 'hi' } }] }));
    await adapter.complete('hello', { model: 'gpt-4o', onUsage });
    expect(seen).toEqual([]);
  });
});
