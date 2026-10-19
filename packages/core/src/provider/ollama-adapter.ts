import { LareError } from '../error/error.js';
import { defaultLogger } from '../logger/logger.js';
import type { ProviderConfig } from '../config/config.js';
import type {
  CompletionOptions,
  ModelInfo,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderUsage,
  ToolSpec,
} from './provider.js';
import type { LareCodeFetch } from './fetch.js';
import { capabilitiesFor, modelCapabilities } from './capabilities.js';

export interface OllamaAdapterOptions {
  name: string;
  baseUrl: string;
  models: string[];
  capabilities?: ProviderCapabilities;
  fetchImpl?: LareCodeFetch;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: { name: string }[];
}

interface OllamaStreamLine {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function ollamaUsage(chunk: { prompt_eval_count?: number; eval_count?: number }): ProviderUsage {
  return { input: chunk.prompt_eval_count ?? 0, output: chunk.eval_count ?? 0 };
}

export class OllamaAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly catalog: ModelInfo[];
  private readonly fetchImpl: LareCodeFetch;

  constructor(options: OllamaAdapterOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.capabilities = options.capabilities ?? capabilitiesFor('ollama');
    this.catalog = options.models.map((id) => ({
      id,
      name: id,
      provider: this.name,
      capabilities: modelCapabilities(this.capabilities, id),
    }));
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json' };
  }

  private requestBody(prompt: string, options: CompletionOptions, stream: boolean) {
    const messages = [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ];
    const body: Record<string, unknown> = { model: options.model, messages, stream };
    const opts: Record<string, unknown> = {};
    if (options.temperature !== undefined) opts.temperature = options.temperature;
    if (options.maxTokens !== undefined) opts.num_predict = options.maxTokens;
    if (Object.keys(opts).length > 0) body.options = opts;
    if (options.tools?.length) {
      body.tools = options.tools.map((tool: ToolSpec) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
    }
    return body;
  }

  private httpError(status: number): LareError {
    return new LareError(
      status === 401 || status === 403 ? 'PROVIDER_AUTH_FAILED' : 'PROVIDER_UNAVAILABLE',
      `${this.name} returned ${status}`,
      { context: { provider: this.name, status }, retryable: status >= 500 }
    );
  }

  private networkError(error: unknown): LareError {
    return LareError.wrap(
      'NETWORK_ERROR',
      error instanceof Error ? error : new Error(String(error)),
      { provider: this.name }
    );
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        headers: this.headers(),
      });
      if (!response.ok) throw new Error(`${this.name} tags endpoint returned ${response.status}`);
      const data = (await response.json()) as OllamaTagsResponse;
      if (!Array.isArray(data.models)) throw new Error('malformed tags response');
      return data.models.map((entry) => ({
        id: entry.name,
        name: entry.name,
        provider: this.name,
        capabilities: modelCapabilities(this.capabilities, entry.name),
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
      response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, false)),
        signal: options.abortSignal,
      });
    } catch (error) {
      throw this.networkError(error);
    }

    if (!response.ok) throw this.httpError(response.status);

    const data = (await response.json()) as OllamaChatResponse;
    if (data.error) {
      throw LareError.from('PROVIDER_UNAVAILABLE', data.error, { provider: this.name });
    }
    if (
      options.onUsage &&
      (data.prompt_eval_count !== undefined || data.eval_count !== undefined)
    ) {
      options.onUsage(ollamaUsage(data));
    }
    const text = data.message?.content;
    if (text === undefined || text === null) {
      throw LareError.from('PROVIDER_UNAVAILABLE', 'completion response had no text', {
        provider: this.name,
      });
    }
    return text;
  }

  async *streamComplete(prompt: string, options: CompletionOptions): AsyncGenerator<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(prompt, options, true)),
        signal: options.abortSignal,
      });
    } catch (error) {
      throw this.networkError(error);
    }

    if (!response.ok || !response.body) {
      throw new LareError('PROVIDER_UNAVAILABLE', `${this.name} stream unavailable`, {
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
        if (!line.trim()) continue;
        let chunk: OllamaStreamLine;
        try {
          chunk = JSON.parse(line) as OllamaStreamLine;
        } catch {
          defaultLogger.debug('unparseable stream line', { provider: this.name });
          continue;
        }
        if (chunk.error) {
          throw LareError.from('PROVIDER_UNAVAILABLE', chunk.error, { provider: this.name });
        }
        if (chunk.message?.content) yield chunk.message.content;
        if (chunk.done) {
          if (options.onUsage) options.onUsage(ollamaUsage(chunk));
          return;
        }
      }
    }
  }
}

export function ollamaAdapterFromConfig(name: string, config: ProviderConfig): OllamaAdapter {
  return new OllamaAdapter({
    name,
    baseUrl: config.baseUrl,
    models: config.models,
    capabilities: capabilitiesFor('ollama'),
  });
}
