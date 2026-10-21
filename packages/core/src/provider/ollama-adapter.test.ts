import { describe, expect, it, vi } from 'vitest';
import { OllamaAdapter } from './ollama-adapter.js';
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

function adapter(fetchImpl: LareCodeFetch): OllamaAdapter {
  return new OllamaAdapter({
    name: 'local',
    baseUrl: 'http://localhost:11434',
    models: ['m'],
    fetchImpl,
  });
}

describe('OllamaAdapter', () => {
  it('streams text, tool calls, and usage from newline-delimited JSON', async () => {
    const body = [
      JSON.stringify({ message: { content: 'hel' } }),
      JSON.stringify({
        message: {
          content: 'lo',
          tool_calls: [{ function: { name: 'read', arguments: { path: 'a.txt' } } }],
        },
      }),
      JSON.stringify({ done: true, prompt_eval_count: 9, eval_count: 4 }),
      '',
    ].join('\n');
    const requests: { init?: RequestInit }[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ init });
      return rawStream(body);
    }) as LareCodeFetch;
    const usage = vi.fn();
    const events = [];

    for await (const event of adapter(fetchImpl).streamChat(
      [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read', arguments: '' }] },
        { role: 'tool', content: 'contents', toolCallId: 'c1' },
      ],
      {
        model: 'm',
        onUsage: usage,
        tools: [
          {
            name: 'read',
            description: 'read a file',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'hel' },
      { type: 'text', text: 'lo' },
      { type: 'usage', usage: { input: 9, output: 4 } },
      {
        type: 'tool_calls',
        calls: [{ id: 'call_0', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
    ]);
    expect(usage).toHaveBeenCalledWith({ input: 9, output: 4 });

    const request = JSON.parse(String(requests[0]?.init?.body)) as {
      messages?: { role: string; tool_name?: string }[];
      tools?: { function?: { parameters?: unknown } }[];
    };
    expect(request.messages?.at(-1)).toEqual({
      role: 'tool',
      content: 'contents',
      tool_name: 'read',
    });
    expect(request.tools?.[0]?.function?.parameters).toBeDefined();
  });

  it('fails the stream when a chunk carries an error', async () => {
    const body = `${JSON.stringify({ error: 'model not found' })}\n`;
    const consume = async (): Promise<void> => {
      for await (const _event of adapter((async () => rawStream(body)) as LareCodeFetch).streamChat(
        [{ role: 'user', content: 'go' }],
        { model: 'm' }
      )) {
        // drain
      }
    };

    await expect(consume()).rejects.toThrow('model not found');
  });

  it('reports completion usage and an actionable rate-limit error', async () => {
    const usage = vi.fn();
    const complete = await adapter((async () =>
      okJson({
        message: { content: 'hi' },
        prompt_eval_count: 5,
        eval_count: 2,
      })) as LareCodeFetch).complete('go', { model: 'm', onUsage: usage });
    expect(complete).toBe('hi');
    expect(usage).toHaveBeenCalledWith({ input: 5, output: 2 });

    const limited = adapter((async () => ({ ok: false, status: 429 })) as unknown as LareCodeFetch);
    await expect(limited.complete('go', { model: 'm' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('switch models'),
    });
  });
});
