import { LumpsError } from '../error/error.js';
import { defaultLogger, Logger, createConsoleHandler } from '../logger/logger.js';
import type { Config, ProviderConfig } from '../config/config.js';
import type {
  CompletionOptions,
  ModelInfo,
  ProviderAdapter,
  ProviderCapabilities,
  ToolSpec,
} from './provider.js';
import type { LumpsCodeFetch } from './fetch.js';

export interface OpenAIAdapterOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  capabilities?: ProviderCapabilities;
  fetchImpl?: LumpsCodeFetch;
}

interface OpenAICompletionResponse {
  choices: { text?: string }[];
}

interface OpenAIModelsResponse {
  data?: { id: string }[];
}

interface OpenAIStreamChunk {
  choices?: { text?: string }[];
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly catalog: ModelInfo[];
  private readonly fetchImpl: LumpsCodeFetch;

  constructor(options: OpenAIAdapterOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.capabilities = options.capabilities ?? {
      tools: true,
      vision: false,
      reasoning: false,
      streaming: true,
      maxTokens: 4096,
    };
    this.catalog = options.models.map(
      (id) =>
        ({
          id,
          name: id,
          provider: this.name,
          capabilities: this.capabilities,
        }) satisfies ModelInfo
    );
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
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
    };
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
        capabilities: this.capabilities,
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
        signal: options.abortSignal,
      });
    } catch (error) {
      throw LumpsError.wrap(
        'NETWORK_ERROR',
        error instanceof Error ? error : new Error(String(error)),
        {
          provider: this.name,
          baseUrl: this.baseUrl,
        }
      );
    }

    if (!response.ok) {
      throw new LumpsError(
        response.status === 401 || response.status === 403
          ? 'PROVIDER_AUTH_FAILED'
          : 'PROVIDER_UNAVAILABLE',
        `${this.name} returned ${response.status}`,
        {
          context: { provider: this.name, status: response.status },
          retryable: response.status >= 500,
        }
      );
    }

    const data = (await response.json()) as OpenAICompletionResponse;
    const text = data.choices?.[0]?.text;
    if (text === undefined)
      throw LumpsError.from('PROVIDER_UNAVAILABLE', 'completion response had no text', {
        provider: this.name,
      });
    return text;
  }

  async *streamComplete(prompt: string, options: CompletionOptions): AsyncGenerator<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, true)),
        signal: options.abortSignal,
      });
    } catch (error) {
      throw LumpsError.wrap(
        'NETWORK_ERROR',
        error instanceof Error ? error : new Error(String(error)),
        {
          provider: this.name,
        }
      );
    }

    if (!response.ok || !response.body) {
      throw new LumpsError('PROVIDER_UNAVAILABLE', `${this.name} stream unavailable`, {
        context: { provider: this.name, status: response.status },
      });
    }

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
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as OpenAIStreamChunk;
          const text = chunk.choices?.[0]?.text;
          if (text) yield text;
        } catch {
          defaultLogger.debug('unparseable stream chunk', { provider: this.name });
        }
      }
    }
  }
}

export function openAIAdapterFromConfig(name: string, config: ProviderConfig): OpenAIAdapter {
  return new OpenAIAdapter({
    name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    models: config.models,
  });
}

export function providersFromConfig(config: Config): ProviderAdapter[] {
  return Object.entries(config.providers)
    .filter(
      ([, entry]) =>
        entry.type === 'openai-compatible' || entry.type === 'custom' || entry.type === 'zai'
    )
    .map(([name, entry]) => openAIAdapterFromConfig(name, entry));
}

export function logProviderCatalog(adapter: ProviderAdapter): void {
  const logger = new Logger({ level: 'info', handlers: [createConsoleHandler()] });
  logger.debug('provider catalog ready', { provider: adapter.name, models: adapter.models.length });
}
