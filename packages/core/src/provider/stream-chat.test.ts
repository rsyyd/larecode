import { describe, expect, it } from 'vitest';
import type { LareCodeFetch } from './fetch.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import type { ProviderStreamEvent } from './provider.js';

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

async function collect(
  stream: AsyncGenerator<ProviderStreamEvent>
): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('AnthropicAdapter streamChat', () => {
  it('sends tool history and streams text, usage, and tool calls', async () => {
    const sse =
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"checking"}}',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"read"}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}',
        'event: message_delta',
        'data: {"type":"message_delta","usage":{"output_tokens":7}}',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n') + '\n';

    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return rawStream(sse);
    }) as LareCodeFetch;
    const adapter = new AnthropicAdapter({
      name: 'anthropic',
      baseUrl: 'http://mock',
      apiKey: 'k',
      models: ['m'],
      fetchImpl,
    });

    const events = await collect(
      adapter.streamChat(
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'tu_0', name: 'read', arguments: '{"path":"b"}' }],
          },
          { role: 'tool', content: 'ok', toolCallId: 'tu_0' },
        ],
        {
          model: 'm',
          tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
        }
      )
    );

    expect(events).toEqual([
      { type: 'text', text: 'checking' },
      { type: 'usage', usage: { input: 12, output: 7 } },
      { type: 'tool_calls', calls: [{ id: 'tu_1', name: 'read', arguments: '{"path":"a.txt"}' }] },
    ]);
    expect(body.system).toBe('sys');
    expect(body.tools).toEqual([
      { name: 'read', description: 'read', input_schema: { type: 'object' } },
    ]);
    expect(body.messages).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_0', name: 'read', input: { path: 'b' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_0', content: 'ok' }] },
    ]);
  });
});

describe('OllamaAdapter streamChat', () => {
  it('sends tool history and streams text, usage, and tool calls', async () => {
    const ndjson =
      [
        '{"message":{"content":"checking"},"done":false}',
        '{"message":{"tool_calls":[{"function":{"name":"read","arguments":{"path":"a.txt"}}}]},"done":false}',
        '{"done":true,"prompt_eval_count":9,"eval_count":4}',
        '',
      ].join('\n') + '\n';

    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return rawStream(ndjson);
    }) as LareCodeFetch;
    const adapter = new OllamaAdapter({
      name: 'ollama',
      baseUrl: 'http://mock',
      models: ['m'],
      fetchImpl,
    });

    const events = await collect(
      adapter.streamChat(
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_0', name: 'read', arguments: '{"path":"b"}' }],
          },
          { role: 'tool', content: 'ok', toolCallId: 'call_0' },
        ],
        {
          model: 'm',
          tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
        }
      )
    );

    expect(events).toEqual([
      { type: 'text', text: 'checking' },
      { type: 'usage', usage: { input: 9, output: 4 } },
      {
        type: 'tool_calls',
        calls: [{ id: 'call_0', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
    ]);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'read', arguments: { path: 'b' } } }],
      },
      { role: 'tool', content: 'ok', tool_name: 'read' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'read', description: 'read', parameters: { type: 'object' } },
      },
    ]);
  });
});
