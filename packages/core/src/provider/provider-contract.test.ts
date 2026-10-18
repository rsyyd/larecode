import { describe, expect, it } from 'vitest';
import type { LumpsCodeFetch } from './fetch.js';
import type { ProviderAdapter } from './provider.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { modelCapabilities } from './capabilities.js';

function okJson(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response;
}

function statusResponse(status: number): Response {
  return { ok: false, status } as unknown as Response;
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

interface ContractSpec {
  label: string;
  create(fetchImpl: LumpsCodeFetch): ProviderAdapter;
  endpointFragment: string;
  isModelsUrl(url: string): boolean;
  modelsResponse(): unknown;
  completionResponse(text: string): unknown;
  streamBody(chunks: string[]): string;
}

const SPECS: ContractSpec[] = [
  {
    label: 'openai-compatible',
    create: (f) =>
      new OpenAIAdapter({
        name: 'openai-compatible',
        baseUrl: 'http://mock/v1',
        apiKey: 'k',
        models: ['cfg-model'],
        fetchImpl: f,
      }),
    endpointFragment: '/chat/completions',
    isModelsUrl: (url) => url.endsWith('/models'),
    modelsResponse: () => ({ data: [{ id: 'm1' }, { id: 'm2' }] }),
    completionResponse: (text) => ({ choices: [{ message: { content: text } }] }),
    streamBody: (chunks) =>
      chunks
        .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
        .join('') + 'data: [DONE]\n\n',
  },
  {
    label: 'anthropic',
    create: (f) =>
      new AnthropicAdapter({
        name: 'anthropic',
        baseUrl: 'http://mock',
        apiKey: 'k',
        models: ['cfg-model'],
        fetchImpl: f,
      }),
    endpointFragment: '/v1/messages',
    isModelsUrl: (url) => url.endsWith('/models'),
    modelsResponse: () => ({ data: [{ id: 'm1', display_name: 'Model One' }, { id: 'm2' }] }),
    completionResponse: (text) => ({ content: [{ type: 'text', text }] }),
    streamBody: (chunks) =>
      chunks
        .map(
          (c) =>
            `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } })}\n\n`
        )
        .join('') + 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  },
  {
    label: 'ollama',
    create: (f) =>
      new OllamaAdapter({
        name: 'ollama',
        baseUrl: 'http://mock',
        models: ['cfg-model'],
        fetchImpl: f,
      }),
    endpointFragment: '/api/chat',
    isModelsUrl: (url) => url.endsWith('/api/tags'),
    modelsResponse: () => ({ models: [{ name: 'm1' }, { name: 'm2' }] }),
    completionResponse: (text) => ({ message: { role: 'assistant', content: text } }),
    streamBody: (chunks) =>
      chunks.map((c) => `${JSON.stringify({ message: { content: c }, done: false })}\n`).join('') +
      `${JSON.stringify({ done: true })}\n`,
  },
];

describe.each(SPECS)('provider contract: $label', (spec) => {
  function dispatchFetch(responses: { models?: Response; completion?: Response }): {
    fetchImpl: LumpsCodeFetch;
    calls: { url: string; init?: RequestInit }[];
  } {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : String(url);
      calls.push({ url: u, init });
      if (spec.isModelsUrl(u)) return responses.models ?? okJson(spec.modelsResponse());
      return responses.completion ?? okJson(spec.completionResponse('contract text'));
    }) as LumpsCodeFetch;
    return { fetchImpl, calls };
  }

  it('models(): returns endpoint catalog with capability metadata', async () => {
    const { fetchImpl } = dispatchFetch({});
    const adapter = spec.create(fetchImpl);
    const models = await adapter.models();

    expect(models.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(models.every((m) => m.provider === spec.label)).toBe(true);
    expect(
      models.every((m) => m.capabilities !== undefined && m.capabilities.streaming === true)
    ).toBe(true);
  });

  it('models(): falls back to the configured catalog when the endpoint fails', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as LumpsCodeFetch;
    const adapter = spec.create(failing);
    const models = await adapter.models();
    expect(models.map((m) => m.id)).toEqual(['cfg-model']);
  });

  it('complete(): round-trips prompt and model', async () => {
    const { fetchImpl, calls } = dispatchFetch({});
    const adapter = spec.create(fetchImpl);
    const text = await adapter.complete('round trip', { model: 'm1', systemPrompt: 'be brief' });

    expect(text).toBe('contract text');
    expect(calls[0].url).toContain(spec.endpointFragment);
    expect(calls[0].init?.method).toBe('POST');

    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('m1');
    expect(body.stream).toBe(false);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('streamComplete(): yields chunks in order', async () => {
    const { fetchImpl } = dispatchFetch({
      completion: rawStream(spec.streamBody(['a', 'b', 'c'])),
    });
    const adapter = spec.create(fetchImpl);

    const received: string[] = [];
    for await (const chunk of adapter.streamComplete('stream', { model: 'm1' })) {
      received.push(chunk);
    }
    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('complete(): maps 401 to PROVIDER_AUTH_FAILED', async () => {
    const { fetchImpl } = dispatchFetch({ completion: statusResponse(401) });
    const adapter = spec.create(fetchImpl);

    await expect(adapter.complete('hi', { model: 'm1' })).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
    });
  });

  it('complete(): maps 500 to retryable PROVIDER_UNAVAILABLE', async () => {
    const { fetchImpl } = dispatchFetch({ completion: statusResponse(500) });
    const adapter = spec.create(fetchImpl);

    await expect(adapter.complete('hi', { model: 'm1' })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('complete(): maps network failure to NETWORK_ERROR', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as LumpsCodeFetch;
    const adapter = spec.create(failing);

    await expect(adapter.complete('hi', { model: 'm1' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('exposes provider-level capabilities', () => {
    const noop = (async () => okJson({})) as LumpsCodeFetch;
    const adapter = spec.create(noop);

    expect(adapter.capabilities.tools).toBe(true);
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.maxTokens).toBeGreaterThan(0);
  });
});

describe('capability metadata heuristics', () => {
  const base = { tools: true, vision: false, reasoning: false, streaming: true, maxTokens: 4096 };

  it('upgrades vision and reasoning from the model id', () => {
    expect(modelCapabilities(base, 'qwen2.5-vl').vision).toBe(true);
    expect(modelCapabilities(base, 'llava:13b').vision).toBe(true);
    expect(modelCapabilities(base, 'gpt-4o').vision).toBe(true);
    expect(modelCapabilities(base, 'deepseek-r1').reasoning).toBe(true);
    expect(modelCapabilities(base, 'glm-4.6').reasoning).toBe(true);
    expect(modelCapabilities(base, 'o1-preview').reasoning).toBe(true);
  });

  it('never downgrades a provider-level capability', () => {
    const visionBase = { ...base, vision: true };
    expect(modelCapabilities(visionBase, 'llama3').vision).toBe(true);
    expect(modelCapabilities(base, 'llama3').vision).toBe(false);
    expect(modelCapabilities(base, 'llama3').reasoning).toBe(false);
  });
});
