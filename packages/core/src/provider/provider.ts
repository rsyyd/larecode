import type { ProviderConfig } from '../config/config.js';
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

export interface CompletionOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  systemPrompt?: string;
  abortSignal?: AbortSignal;
}

export interface ProviderAdapter {
  name: string;
  capabilities: ProviderCapabilities;
  models(): Promise<ModelInfo[]>;
  complete(prompt: string, options: CompletionOptions): Promise<string>;
  streamComplete(prompt: string, options: CompletionOptions): AsyncGenerator<string>;
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

  /**
   * Creates an OpenAI-compatible provider adapter from a ProviderConfig.
   */
  static createOpenAIAdapter(name: string, config: ProviderConfig): ProviderAdapter {
    return openAIAdapterFromConfig(name, config);
  }
}
