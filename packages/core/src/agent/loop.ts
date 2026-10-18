import { Providers, providersFromConfig } from '../provider/provider.js';
import { loadEffectiveConfig } from '../config/config.js';
import { LumpsError } from '../error/error.js';
import {
  createUsageRecorder,
  estimateTokens,
  type UsageAggregate,
  type UsageRecorder,
} from '../usage/usage.js';

export type HaltReason = 'iterations' | 'budget' | 'duration';

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

const ZERO_COST = { inputCost: 0, outputCost: 0, totalCost: 0 };

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

  private cancelled(): LumpsError {
    return new LumpsError('CANCELLED', 'agent loop cancelled');
  }

  private halt(reason: HaltReason): void {
    this.haltReason = reason;
    this.callbacks.onHalt?.(reason);
  }

  private recordUsage(prompt: string, completion: string, iterationTokens: number): void {
    const input = iterationTokens;
    const output = estimateTokens(completion);
    this.usage.record(
      { input, output, total: input + output },
      ZERO_COST,
      this.options.model,
      this.options.provider
    );
  }

  async *run(prompt: string): AsyncGenerator<string> {
    const signal = this.options.abortSignal;
    const startedAt = Date.now();

    const provider = this.providers.get(this.options.provider);
    if (!provider) {
      throw new LumpsError(
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
      try {
        const stream = provider.streamComplete(prompt, {
          model: this.options.model,
          abortSignal: signal,
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

      this.recordUsage(prompt, completion, iterationTokens);

      if (this.haltReason) return;

      this.callbacks.onComplete?.(total);
      return;
    }
  }
}
