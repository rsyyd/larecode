import { LareError } from '../error/error.js';
import type { UsageAggregate } from '../usage/usage.js';
import type { HaltReason } from './loop.js';
import { DefaultAgentRuntime, type AgentRuntime, type AgentRuntimeOptions } from './runtime.js';

export interface AgentRuntimeLoopOptions extends AgentRuntimeOptions {
  abortSignal?: AbortSignal;
}

export class AgentRuntimeLoop {
  private readonly runtime: AgentRuntime;
  private readonly signal?: AbortSignal;
  private haltReason: HaltReason | null = null;

  constructor(options: AgentRuntimeLoopOptions = {}) {
    this.runtime = new DefaultAgentRuntime(options);
    this.signal = options.abortSignal;
  }

  getUsage(): UsageAggregate {
    return this.runtime.getUsage();
  }

  getHaltReason(): HaltReason | null {
    return this.haltReason;
  }

  async *run(prompt: string): AsyncGenerator<string> {
    const signal = this.signal ?? new AbortController().signal;

    for await (const event of this.runtime.run({ prompt, signal })) {
      if (event.type === 'text') {
        yield event.text;
      } else if (event.type === 'halt') {
        if (event.reason === 'completed') continue;
        if (event.reason === 'cancelled') {
          throw new LareError('CANCELLED', 'agent runtime cancelled');
        }
        if (event.reason === 'error') {
          throw new LareError('UNKNOWN', 'agent runtime failed');
        }
        this.haltReason = event.reason;
      } else if (event.type === 'error') {
        throw new LareError(event.error.code, event.error.message, {
          retryable: event.error.retryable,
          context: event.error.context,
        });
      }
    }
  }
}
