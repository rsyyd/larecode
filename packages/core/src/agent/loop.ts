import { Providers } from '../provider/provider.js';
import { loadEffectiveConfig } from '../config/config.js';
import { LumpsError } from '../error/error.js';
import { Logger } from '../logger/logger.js';

export interface AgentLoopOptions {
  provider: string;
  model: string;
  maxIterations: number;
  maxToolCalls: number;
  tokenBudget: number;
  durationBudget: number;
  abortSignal?: AbortSignal;
}

export interface AgentLoopCallbacks {
  onIterationStart?: (iteration: number) => void;
  onToolCall?: (tool: string, args: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  onComplete?: (result: string) => void;
  onError?: (error: Error) => void;
}

export class AgentLoop {
  private options: AgentLoopOptions;
  private callbacks: AgentLoopCallbacks;
  private providers: Providers;
  private logger: Logger;

  constructor(options: AgentLoopOptions, callbacks: AgentLoopCallbacks = {}) {
    this.options = options;
    this.callbacks = callbacks;
    this.providers = new Providers();
    this.logger = new Logger({ level: 'info' });

    // Load config and register providers
    const config = loadEffectiveConfig();
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      if (providerConfig.type === 'openai-compatible') {
        const adapter = Providers.createOpenAIAdapter(name, providerConfig);
        this.providers.register(adapter);
      }
    }
  }

  async *run(prompt: string): AsyncGenerator<string> {
    this.callbacks.onIterationStart?.(0);
    const provider = this.providers.get(this.options.provider);
    if (!provider) {
      throw new LumpsError(
        'PROVIDER_UNAVAILABLE',
        `Provider "${this.options.provider}" is not available`
      );
    }
    try {
      const result = await provider.complete(prompt, {
        model: this.options.model,
        maxTokens: this.options.maxIterations * 100, // rough estimate
      });
      this.callbacks.onComplete?.(result);
      yield result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Agent loop error', { error: err.message }, err);
      this.callbacks.onError?.(err);
      throw err;
    }
  }
}
