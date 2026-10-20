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
import type { LareCodeFetch } from './fetch.js';
import { capabilitiesFor, modelCapabilities } from './capabilities.js';

export interface AnthropicAdapterOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  capabilities?: ProviderCapabilities;
  fetchImpl?: LareCodeFetch;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
  usage?: AnthropicUsage;
}

interface AnthropicModelsResponse {
  data?: { id: string; display_name?: string }[];
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  delta?: { type?: string; text?: string; partial_json?: string };
  content_block?: { type?: string; id?: string; name?: string };
  error?: { message?: string };
  message?: { usage?: AnthropicUsage };
  usage?: AnthropicUsage;
}

function anthropicUsage(usage: AnthropicUsage, outputOverride?: number): ProviderUsage {
  return {
    input: usage.input_tokens ?? 0,
    output: outputOverride ?? usage.output_tokens ?? 0,
    ...(usage.cache_read_input_tokens ? { cacheRead: usage.cache_read_input_tokens } : {}),
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly catalog: ModelInfo[];
  private readonly fetchImpl: LareCodeFetch;
  private readonly version = '2023-06-01';

  constructor(options: AnthropicAdapterOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.capabilities = options.capabilities ?? capabilitiesFor('anthropic');
    this.catalog = options.models.map((id) => ({
      id,
      name: id,
      provider: this.name,
      capabilities: modelCapabilities(this.capabilities, id),
    }));
  }

  private url(path: string): string {
    const base = this.baseUrl;
    return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`;
  }

  private httpError(status: number): LareError {
    return new LareError(
      status === 401 || status === 403
        ? 'PROVIDER_AUTH_FAILED'
        : status === 429
          ? 'RATE_LIMITED'
          : 'PROVIDER_UNAVAILABLE',
      `${this.name} returned ${status}`,
      {
        context: { provider: this.name, status },
        retryable: status === 429 || status >= 500,
      }
    );
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.version,
    };
  }

  private toolPayload(tools: ToolSpec[] | undefined): unknown[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  private requestBody(prompt: string, options: CompletionOptions, stream: boolean) {
    const messages = [{ role: 'user', content: prompt }];
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? this.capabilities.maxTokens,
      messages,
      stream,
    };
    if (options.systemPrompt) body.system = options.systemPrompt;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    const tools = this.toolPayload(options.tools);
    if (tools) body.tools = tools;
    return body;
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const response = await this.fetchImpl(this.url('/models'), { headers: this.headers() });
      if (!response.ok) throw new Error(`${this.name} models endpoint returned ${response.status}`);
      const data = (await response.json()) as AnthropicModelsResponse;
      if (!Array.isArray(data.data)) throw new Error('malformed models response');
      return data.data.map((entry) => ({
        id: entry.id,
        name: entry.display_name ?? entry.id,
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
      response = await this.fetchImpl(this.url('/messages'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, false)),
        signal: options.abortSignal,
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

    const data = (await response.json()) as AnthropicMessageResponse;
    const text = data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    if (text === undefined || text === null || text === '')
      throw LareError.from('PROVIDER_UNAVAILABLE', 'completion response had no text', {
        provider: this.name,
      });
    if (data.usage && options.onUsage) options.onUsage(anthropicUsage(data.usage));
    return text;
  }

  private chatMessages(messages: ProviderMessage[]): {
    system?: string;
    messages: Record<string, unknown>[];
  } {
    let system: string | undefined;
    const converted: Record<string, unknown>[] = [];
    for (const message of messages) {
      if (message.role === 'system') {
        system = system ? `${system}\n\n${message.content}` : message.content;
        continue;
      }
      if (message.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        };
        const last = converted[converted.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
        else converted.push({ role: 'user', content: [block] });
        continue;
      }
      if (message.role === 'assistant') {
        const blocks: Record<string, unknown>[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
          let input: unknown = {};
          try {
            input = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            input = {};
          }
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
        }
        converted.push({ role: 'assistant', content: blocks });
        continue;
      }
      converted.push({ role: 'user', content: message.content });
    }
    return { system, messages: converted };
  }

  private chatRequestBody(
    messages: ProviderMessage[],
    options: CompletionOptions,
    stream: boolean
  ) {
    const { system, messages: converted } = this.chatMessages(messages);
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? this.capabilities.maxTokens,
      messages: converted,
      stream,
    };
    const systemPrompt = system ?? options.systemPrompt;
    if (systemPrompt) body.system = systemPrompt;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    const tools = this.toolPayload(options.tools);
    if (tools) body.tools = tools;
    return body;
  }

  async *streamChat(
    messages: ProviderMessage[],
    options: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url('/messages'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.chatRequestBody(messages, options, true)),
        signal: options.abortSignal,
      });
    } catch (error) {
      throw LareError.wrap(
        'NETWORK_ERROR',
        error instanceof Error ? error : new Error(String(error)),
        { provider: this.name }
      );
    }

    if (!response.ok || !response.body) {
      throw this.httpError(response.status);
    }

    const calls = new Map<number, ProviderToolCall>();
    let seenUsage: AnthropicUsage | null = null;
    let outputTokens = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (!payload.trim()) continue;
        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          defaultLogger.debug('unparseable stream chunk', { provider: this.name });
          continue;
        }
        if (event.type === 'message_start' && event.message?.usage) {
          seenUsage = { ...event.message.usage };
        } else if (event.type === 'message_delta' && event.usage) {
          seenUsage = seenUsage ? Object.assign({}, seenUsage, event.usage) : event.usage;
          if (event.usage.output_tokens !== undefined) outputTokens = event.usage.output_tokens;
        } else if (
          event.type === 'content_block_start' &&
          event.content_block?.type === 'tool_use'
        ) {
          const index = event.index ?? calls.size;
          calls.set(index, {
            id: event.content_block.id ?? `call_${index}`,
            name: event.content_block.name ?? '',
            arguments: '',
          });
        } else if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            const index = event.index ?? 0;
            const call = calls.get(index);
            if (call) call.arguments += event.delta.partial_json;
          }
        } else if (event.type === 'error') {
          throw new LareError('PROVIDER_UNAVAILABLE', event.error?.message ?? 'stream error', {
            context: { provider: this.name },
          });
        }
        if (event.type === 'message_stop') {
          if (seenUsage) {
            const usage = anthropicUsage(seenUsage, outputTokens || seenUsage.output_tokens);
            options.onUsage?.(usage);
            yield { type: 'usage', usage };
          }
          const completed = [...calls.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, call]) => call)
            .filter((call) => call.name.length > 0);
          if (completed.length > 0) yield { type: 'tool_calls', calls: completed };
          return;
        }
      }
    }
  }

  async *streamComplete(prompt: string, options: CompletionOptions): AsyncGenerator<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url('/messages'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, true)),
        signal: options.abortSignal,
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let seenUsage: AnthropicUsage | null = null;
    let outputTokens = 0;
    let reported = false;
    const reportUsage = () => {
      if (reported || !seenUsage || !options.onUsage) return;
      reported = true;
      options.onUsage(anthropicUsage(seenUsage, outputTokens || seenUsage.output_tokens));
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (!payload.trim()) continue;
        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          defaultLogger.debug('unparseable stream chunk', { provider: this.name });
          continue;
        }
        if (event.type === 'message_start' && event.message?.usage) {
          seenUsage = event.message.usage;
        } else if (event.type === 'message_delta' && event.usage) {
          if (event.usage.output_tokens !== undefined) outputTokens = event.usage.output_tokens;
        } else if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          yield event.delta.text;
        } else if (event.type === 'error') {
          throw new LareError('PROVIDER_UNAVAILABLE', event.error?.message ?? 'stream error', {
            context: { provider: this.name },
          });
        }
        if (event.type === 'message_stop') {
          reportUsage();
          return;
        }
      }
    }
    reportUsage();
  }
}

export function anthropicAdapterFromConfig(name: string, config: ProviderConfig): AnthropicAdapter {
  return new AnthropicAdapter({
    name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: config.models,
    capabilities: capabilitiesFor('anthropic'),
  });
}
