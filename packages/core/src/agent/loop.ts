import { Providers, providersFromConfig } from '../provider/provider.js';
import type { ProviderUsage } from '../provider/provider.js';
import { loadEffectiveConfig } from '../config/config.js';
import { LareError } from '../error/error.js';
import {
  DEFAULT_MODEL_PRICING,
  estimateCost,
  createUsageRecorder,
  estimateTokens,
  type UsageAggregate,
  type UsageRecorder,
} from '../usage/usage.js';

export type HaltReason = 'iterations' | 'tool_calls' | 'budget' | 'duration';

export interface AgentLoopOptions {
  provider: string;
  model: string;
  maxIterations: number;
  maxToolCalls: number;
  tokenBudget: number;
  durationBudget: number;
  abortSignal?: AbortSignal;
  providers?: Providers;
  usageRecorder?: UsageRecorder;
}

export interface AgentLoopCallbacks {
  onIterationStart?: (iteration: number) => void;
  onToolCall?: (tool: string, args: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  onHalt?: (reason: HaltReason) => void;
  onComplete?: (result: string) => void;
  onError?: (error: Error) => void;
}

export class AgentLoop {
  private options: AgentLoopOptions;
  private callbacks: AgentLoopCallbacks;
  private providers: Providers;
  private usage: UsageRecorder;
  private tokensUsed = 0;
  private haltReason: HaltReason | null = null;

  constructor(options: AgentLoopOptions, callbacks: AgentLoopCallbacks = {}) {
    this.options = options;
    this.callbacks = callbacks;
    this.usage = options.usageRecorder ?? createUsageRecorder(crypto.randomUUID());
    this.providers = options.providers ?? AgentLoop.providersFromEnvironment();
  }

  private static providersFromEnvironment(): Providers {
    const providers = new Providers();
    const config = loadEffectiveConfig();
    for (const adapter of providersFromConfig(config)) {
      providers.register(adapter);
    }
    return providers;
  }

  getHaltReason(): HaltReason | null {
    return this.haltReason;
  }

  getUsage(): UsageAggregate {
    return this.usage.getAggregate();
  }

  private cancelled(): LareError {
    return new LareError('CANCELLED', 'agent loop cancelled');
  }

  private halt(reason: HaltReason): void {
    this.haltReason = reason;
    this.callbacks.onHalt?.(reason);
  }

  private recordUsage(completion: string, iterationTokens: number, reported?: ProviderUsage): void {
    const input = reported?.input ?? iterationTokens;
    const output = reported?.output ?? estimateTokens(completion);
    const tokens = {
      input,
      output,
      total: input + output,
      ...(reported?.cacheRead ? { cacheRead: reported.cacheRead } : {}),
    };
    const cost = estimateCost(tokens, this.options.model, DEFAULT_MODEL_PRICING);
    this.usage.record(tokens, cost, this.options.model, this.options.provider);
  }

  async *run(prompt: string): AsyncGenerator<string> {
    const signal = this.options.abortSignal;
    const startedAt = Date.now();

    const provider = this.providers.get(this.options.provider);
    if (!provider) {
      throw new LareError(
        'PROVIDER_UNAVAILABLE',
        `Provider "${this.options.provider}" is not available`
      );
    }

    let iteration = 0;
    let total = '';

    while (true) {
      if (signal?.aborted) throw this.cancelled();
      if (iteration >= this.options.maxIterations) {
        this.halt('iterations');
        return;
      }
      if (this.tokensUsed >= this.options.tokenBudget) {
        this.halt('budget');
        return;
      }
      if (Date.now() - startedAt >= this.options.durationBudget) {
        this.halt('duration');
        return;
      }

      this.callbacks.onIterationStart?.(iteration);
      iteration += 1;

      let completion = '';
      let iterationTokens = estimateTokens(prompt);
      let reported: ProviderUsage | undefined;
      try {
        const stream = provider.streamComplete(prompt, {
          model: this.options.model,
          abortSignal: signal,
          onUsage: (usage) => {
            reported = usage;
          },
        });
        for await (const chunk of stream) {
          if (signal?.aborted) throw this.cancelled();
          if (Date.now() - startedAt >= this.options.durationBudget) {
            this.halt('duration');
            break;
          }
          const chunkTokens = estimateTokens(chunk);
          if (this.tokensUsed + chunkTokens > this.options.tokenBudget) {
            this.halt('budget');
            break;
          }
          this.tokensUsed += chunkTokens;
          completion += chunk;
          total += chunk;
          yield chunk;
        }
      } catch (error) {
        if (signal?.aborted) throw this.cancelled();
        const err = error instanceof Error ? error : new Error(String(error));
        this.callbacks.onError?.(err);
        throw err;
      }

      this.recordUsage(completion, iterationTokens, reported);

      if (this.haltReason) return;

      this.callbacks.onComplete?.(total);
      return;
    }
  }
}
