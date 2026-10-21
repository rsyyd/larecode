import { LareError } from '../error/error.js';
import { defaultLogger } from '../logger/logger.js';
import type { ProviderConfig } from '../config/config.js';
import type {
  CompletionOptions,
  ModelInfo,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderMessage,
  ProviderStreamEvent,
  ProviderToolCall,
  ProviderUsage,
  ToolSpec,
} from './provider.js';
import { signalWithTimeout } from './provider.js';
import type { LareCodeFetch } from './fetch.js';
import { capabilitiesFor, modelCapabilities } from './capabilities.js';

export interface OpenAIAdapterOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  capabilities?: ProviderCapabilities;
  headers?: Record<string, string>;
  fetchImpl?: LareCodeFetch;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: OpenAIUsage | null;
}

interface OpenAIModelsResponse {
  data?: { id: string }[];
}

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIStreamChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: OpenAIToolCallDelta[] };
  }[];
  usage?: OpenAIUsage | null;
  error?: { message?: string; code?: string };
}

function mapUsage(usage: OpenAIUsage): ProviderUsage {
  return {
    input: usage.prompt_tokens ?? 0,
    output: usage.completion_tokens ?? 0,
    ...(usage.prompt_tokens_details?.cached_tokens
      ? { cacheRead: usage.prompt_tokens_details.cached_tokens }
      : {}),
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly catalog: ModelInfo[];
  private readonly fetchImpl: LareCodeFetch;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAIAdapterOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.capabilities = options.capabilities ?? capabilitiesFor('openai-compatible');
    this.extraHeaders = options.headers ?? {};
    this.catalog = options.models.map(
      (id) =>
        ({
          id,
          name: id,
          provider: this.name,
          capabilities: modelCapabilities(this.capabilities, id),
        }) satisfies ModelInfo
    );
  }

  private httpError(status: number): LareError {
    const message =
      status === 429
        ? `${this.name} rate limited the request (429); wait a moment and retry, or switch models`
        : `${this.name} returned ${status}`;
    return new LareError(
      status === 401 || status === 403
        ? 'PROVIDER_AUTH_FAILED'
        : status === 429
          ? 'RATE_LIMITED'
          : 'PROVIDER_UNAVAILABLE',
      message,
      {
        context: { provider: this.name, status },
        retryable: status === 429 || status >= 500,
      }
    );
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private toolPayload(tools: ToolSpec[] | undefined): unknown[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  private requestBody(prompt: string, options: CompletionOptions, stream: boolean) {
    const messages = [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ];
    return {
      model: options.model,
      messages,
      stream,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(this.toolPayload(options.tools) ? { tools: this.toolPayload(options.tools) } : {}),
      ...(stream && options.onUsage ? { stream_options: { include_usage: true } } : {}),
    };
  }

  private chatMessages(messages: ProviderMessage[]): unknown[] {
    return messages.map((message) => {
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId ?? '',
          content: message.content,
        };
      }
      return { role: message.role, content: message.content };
    });
  }

  private chatRequestBody(messages: ProviderMessage[], options: CompletionOptions) {
    return {
      model: options.model,
      messages: this.chatMessages(messages),
      stream: true,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(this.toolPayload(options.tools) ? { tools: this.toolPayload(options.tools) } : {}),
      stream_options: { include_usage: true },
    };
  }

  private async errorDetail(response: Response): Promise<string> {
    try {
      const text = (await response.text()).trim();
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) return parsed.error.message;
      } catch {
        return text.replace(/\s+/g, ' ').slice(0, 200);
      }
      return text.replace(/\s+/g, ' ').slice(0, 200);
    } catch {
      return '';
    }
  }

  private async *readStream(response: Response): AsyncGenerator<OpenAIStreamChunk> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trimStart();
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as OpenAIStreamChunk;
          if (chunk.error) {
            throw new LareError(
              'PROVIDER_UNAVAILABLE',
              `${this.name}: ${chunk.error.message ?? chunk.error.code ?? 'stream error'}`,
              { context: { provider: this.name }, retryable: true }
            );
          }
          yield chunk;
        } catch (error) {
          if (error instanceof LareError) throw error;
          defaultLogger.debug('unparseable stream chunk', { provider: this.name });
        }
      }
    }
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.headers() });
      if (!response.ok) {
        throw new Error(`${this.name} models endpoint returned ${response.status}`);
      }
      const data = (await response.json()) as OpenAIModelsResponse;
      if (!Array.isArray(data.data)) throw new Error('malformed models response');
      return data.data.map((entry) => ({
        id: entry.id,
        name: entry.id,
        provider: this.name,
        capabilities: modelCapabilities(this.capabilities, entry.id),
      }));
    } catch (error) {
      defaultLogger.warn('falling back to configured model list', {
        provider: this.name,
        reason: error instanceof Error ? error.message : String(error),
      });
      return this.catalog.map((entry) => ({ ...entry }));
    }
  }

  async complete(prompt: string, options: CompletionOptions): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, false)),
        signal: signalWithTimeout(options.timeoutMs, options.abortSignal),
      });
    } catch (error) {
      throw LareError.wrap(
        'NETWORK_ERROR',
        error instanceof Error ? error : new Error(String(error)),
        { provider: this.name, baseUrl: this.baseUrl }
      );
    }

    if (!response.ok) {
      throw this.httpError(response.status);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content;
    if (text === undefined || text === null)
      throw LareError.from('PROVIDER_UNAVAILABLE', 'completion response had no text', {
        provider: this.name,
      });
    if (data.usage && options.onUsage) options.onUsage(mapUsage(data.usage));
    return text;
  }

  async *streamComplete(prompt: string, options: CompletionOptions): AsyncGenerator<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, true)),
        signal: signalWithTimeout(options.timeoutMs, options.abortSignal),
      });
    } catch (error) {
      throw LareError.wrap(
        'NETWORK_ERROR',
        error instanceof Error ? error : new Error(String(error)),
        { provider: this.name }
      );
    }

    if (!response.ok || !response.body) {
      throw new LareError('PROVIDER_UNAVAILABLE', `${this.name} stream unavailable`, {
        context: { provider: this.name, status: response.status },
      });
    }

    for await (const chunk of this.readStream(response)) {
      if (chunk.usage && options.onUsage) options.onUsage(mapUsage(chunk.usage));
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }

  async *streamChat(
    messages: ProviderMessage[],
    options: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.chatRequestBody(messages, options)),
        signal: signalWithTimeout(options.timeoutMs, options.abortSignal),
      });
    } catch (error) {
      throw LareError.wrap(
        'NETWORK_ERROR',
        error instanceof Error ? error : new Error(String(error)),
        { provider: this.name }
      );
    }

    if (!response.ok || !response.body) {
      const detail = response.ok ? 'empty response body' : await this.errorDetail(response);
      const error = this.httpError(response.status);
      throw new LareError(
        error.code,
        `${this.name} stream failed (${response.status})${detail ? `: ${detail}` : ''}`,
        {
          context: { provider: this.name, status: response.status },
          retryable: error.retryable,
        }
      );
    }

    const calls = new Map<number, ProviderToolCall>();
    for await (const chunk of this.readStream(response)) {
      if (chunk.usage) {
        const usage = mapUsage(chunk.usage);
        options.onUsage?.(usage);
        yield { type: 'usage', usage };
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) yield { type: 'text', text: delta.content };
      for (const part of delta?.tool_calls ?? []) {
        const index = part.index ?? 0;
        const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name = part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        calls.set(index, call);
      }
    }

    const completed = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
      .filter((call) => call.name.length > 0);
    if (completed.length > 0) yield { type: 'tool_calls', calls: completed };
  }
}

export function openAIAdapterFromConfig(
  name: string,
  config: ProviderConfig,
  fetchImpl?: LareCodeFetch
): OpenAIAdapter {
  return new OpenAIAdapter({
    name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: config.models,
    capabilities: capabilitiesFor(config.type),
    ...(config.type === 'openrouter'
      ? {
          headers: { 'HTTP-Referer': 'https://github.com/rsyyd/larecode', 'X-Title': 'larecode' },
        }
      : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
