import {
  AgentLoop,
  LareError,
  Sessions,
  loadEffectiveConfig,
  type AgentLoopOptions,
  type HaltReason,
  type Session,
  type UsageAggregate,
} from '@larecode/core';

export interface LoopLike {
  run(prompt: string): AsyncGenerator<string>;
  getUsage(): UsageAggregate;
  getHaltReason(): HaltReason | null;
}

export interface LareClientOptions {
  workingDir?: string;
  provider?: string;
  model?: string;
  sessions?: Sessions;
  loopFactory?: (options: AgentLoopOptions) => LoopLike;
}

export interface RunOptions {
  sessionId?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'cancelled';

export interface RunResult {
  sessionId: string;
  text: string;
  usage: UsageAggregate;
  halt: HaltReason | null;
  stopReason: StopReason;
}

export const DEFAULT_MAX_ITERATIONS = 40;
export const DEFAULT_MAX_TOOL_CALLS = 200;
export const DEFAULT_TOKEN_BUDGET = 200_000;
export const DEFAULT_DURATION_BUDGET = 600_000;

export class LareClient {
  readonly sessions: Sessions;

  constructor(private readonly options: LareClientOptions = {}) {
    this.sessions = options.sessions ?? new Sessions();
  }

  private loop(signal: AbortSignal): LoopLike {
    const config = loadEffectiveConfig(this.options.workingDir);
    const loopOptions: AgentLoopOptions = {
      provider: this.options.provider ?? config.defaultProvider,
      model: this.options.model ?? config.defaultModel,
      maxIterations: DEFAULT_MAX_ITERATIONS,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      tokenBudget: DEFAULT_TOKEN_BUDGET,
      durationBudget: DEFAULT_DURATION_BUDGET,
      abortSignal: signal,
    };
    return this.options.loopFactory
      ? this.options.loopFactory(loopOptions)
      : new AgentLoop(loopOptions);
  }

  session(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new LareError('SESSION_NOT_FOUND', `no session with id "${sessionId}"`);
    }
    return session;
  }

  async run(prompt: string, options: RunOptions = {}): Promise<RunResult> {
    const session = options.sessionId
      ? this.session(options.sessionId)
      : this.sessions.create(prompt);
    if (options.sessionId) {
      appendMessage(session, 'user', prompt);
      this.sessions.save(session);
    }

    const signal = options.signal ?? new AbortController().signal;
    const loop = this.loop(signal);

    let text = '';
    let cancelled = false;
    try {
      for await (const chunk of loop.run(prompt)) {
        text += chunk;
        options.onChunk?.(chunk);
      }
    } catch (error) {
      if (!(error instanceof LareError && error.code === 'CANCELLED')) throw error;
      cancelled = true;
    }

    const usage = loop.getUsage();
    appendMessage(session, 'assistant', text);
    session.metadata.updatedAt = new Date();
    session.metadata.tokenUsage += usage.totalTokens.total;
    session.metadata.cost += usage.totalCost.totalCost;
    this.sessions.save(session);

    const halt = loop.getHaltReason();
    const stopReason: StopReason = cancelled
      ? 'cancelled'
      : halt === 'budget'
        ? 'max_tokens'
        : 'end_turn';

    return { sessionId: session.id, text, usage, halt, stopReason };
  }
}

function appendMessage(session: Session, role: 'user' | 'assistant', content: string): void {
  session.messages.push({ role, content, timestamp: new Date() });
  session.metadata.messageCount = session.messages.length;
  session.metadata.updatedAt = new Date();
}
