import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic-adapter.js';
import type { LareCodeFetch } from './fetch.js';

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

function okJson(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response;
}

function sse(events: unknown[]): string {
  return events
    .map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n`)
    .join('\n');
}

function adapter(fetchImpl: LareCodeFetch): AnthropicAdapter {
  return new AnthropicAdapter({
    name: 'mock',
    baseUrl: 'http://mock',
    apiKey: 'secret',
    models: ['m'],
    fetchImpl,
  });
}

describe('AnthropicAdapter', () => {
  it('streams text, assembles tool calls, and reports usage', async () => {
    const body = sse([
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'checking ' } },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'read' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"a.txt"}' },
      },
      { type: 'message_delta', usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ]);
    const requests: { init?: RequestInit }[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ init });
      return rawStream(body);
    }) as LareCodeFetch;
    const usage = vi.fn();
    const events = [];

    for await (const event of adapter(fetchImpl).streamChat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'go' },
      ],
      {
        model: 'm',
        systemPrompt: 'sys',
        onUsage: usage,
        tools: [
          {
            name: 'read',
            description: 'read a file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string', description: 'path' } },
              required: ['path'],
            },
          },
        ],
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'checking ' },
      { type: 'usage', usage: { input: 12, output: 7 } },
      {
        type: 'tool_calls',
        calls: [{ id: 'toolu_1', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
    ]);
    expect(usage).toHaveBeenCalledWith({ input: 12, output: 7 });

    const init = requests[0]?.init;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const request = JSON.parse(String(init?.body)) as {
      system?: string;
      tools?: { input_schema?: unknown }[];
    };
    expect(request.system).toBe('sys');
    expect(request.tools?.[0]?.input_schema).toMatchObject({ required: ['path'] });
  });

  it('fails the stream with the provider error message', async () => {
    const body = sse([{ type: 'error', error: { message: 'overloaded' } }]);
    const consume = async (): Promise<void> => {
      for await (const _event of adapter((async () => rawStream(body)) as LareCodeFetch).streamChat(
        [{ role: 'user', content: 'go' }],
        { model: 'm' }
      )) {
        // drain
      }
    };

    await expect(consume()).rejects.toThrow('overloaded');
  });

  it('reports completion usage and an actionable rate-limit error', async () => {
    const usage = vi.fn();
    const complete = await adapter((async () =>
      okJson({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 3, output_tokens: 2 },
      })) as LareCodeFetch).complete('go', { model: 'm', onUsage: usage });
    expect(complete).toBe('hi');
    expect(usage).toHaveBeenCalledWith({ input: 3, output: 2 });

    const limited = adapter((async () => ({ ok: false, status: 429 })) as unknown as LareCodeFetch);
    await expect(limited.complete('go', { model: 'm' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('switch models'),
    });
  });
});
