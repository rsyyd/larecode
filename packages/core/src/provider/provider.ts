import type { Config } from '../config/config.js';
import { anthropicAdapterFromConfig } from './anthropic-adapter.js';
import { ollamaAdapterFromConfig } from './ollama-adapter.js';
import { openAIAdapterFromConfig } from './openai-adapter.js';

export interface ProviderCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  streaming: boolean;
  maxTokens: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: ProviderCapabilities;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderUsage {
  input: number;
  output: number;
  cacheRead?: number;
}

export interface CompletionOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  onUsage?: (usage: ProviderUsage) => void;
}

export function signalWithTimeout(
  timeoutMs: number | undefined,
  signal?: AbortSignal
): AbortSignal {
  if (!timeoutMs || timeoutMs <= 0) return signal ?? new AbortController().signal;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    controller.abort(new Error('request timed out'));
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  const onAbort = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ProviderMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  toolCalls?: ProviderToolCall[];
  toolCallId?: string;
}

export type ProviderStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'tool_calls'; calls: ProviderToolCall[] };

export interface ProviderAdapter {
  name: string;
  capabilities: ProviderCapabilities;
  models(): Promise<ModelInfo[]>;
  complete(prompt: string, options: CompletionOptions): Promise<string>;
  streamComplete(prompt: string, options: CompletionOptions): AsyncGenerator<string>;
  streamChat?(
    messages: ProviderMessage[],
    options: CompletionOptions
  ): AsyncGenerator<ProviderStreamEvent>;
}

export class Providers {
  private adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): ProviderAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export function providersFromConfig(config: Config): ProviderAdapter[] {
  return Object.entries(config.providers).map(([name, entry]) => {
    switch (entry.type) {
      case 'anthropic':
        return anthropicAdapterFromConfig(name, entry);
      case 'ollama':
        return ollamaAdapterFromConfig(name, entry);
      default:
        return openAIAdapterFromConfig(name, entry);
    }
  });
}
