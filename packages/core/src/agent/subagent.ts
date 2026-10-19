import { BUILTIN_AGENTS, type AgentName } from './agents.js';
import { AgentLoop, type HaltReason } from './loop.js';
import { LareError } from '../error/error.js';
import { estimateTokens, type UsageAggregate } from '../usage/usage.js';
import type { Providers } from '../provider/provider.js';

export interface SubagentLoopLike {
  run(prompt: string): AsyncGenerator<string>;
  getUsage(): UsageAggregate;
  getHaltReason(): HaltReason | null;
}

export interface SubagentRunOptions {
  prompt: string;
  provider: string;
  model: string;
  agent?: AgentName;
  depth?: number;
  maxIterations?: number;
  tokenBudget?: number;
  durationBudget?: number;
  compressTo?: number;
  signal?: AbortSignal;
}

export interface SubagentResult {
  agent: AgentName;
  depth: number;
  text: string;
  tokens: number;
  haltReason: HaltReason | null;
}

export interface SubagentsOptions {
  providers?: Providers;
  maxDepth?: number;
  maxConcurrent?: number;
  createLoop?: (options: SubagentRunOptions) => SubagentLoopLike;
}

export const SUBAGENT_DEFAULTS = {
  maxIterations: 12,
  tokenBudget: 50_000,
  durationBudget: 120_000,
  compressTo: 800,
};

export function compressResult(text: string, maxTokens: number): string {
  const trimmed = text.trim();
  if (estimateTokens(trimmed) <= maxTokens) return trimmed;
  const marker = '\n…\n';
  const maxChars = maxTokens * 4;
  const headChars = Math.floor((maxChars - marker.length) * 0.7);
  const head = trimmed.slice(0, headChars).trimEnd();
  const tail = trimmed.slice(-(maxChars - marker.length - headChars)).trimStart();
  return `${head}${marker}${tail}`;
}

export class Subagents {
  private readonly options: SubagentsOptions;
  private active = 0;

  constructor(options: SubagentsOptions = {}) {
    this.options = options;
  }

  get activeCount(): number {
    return this.active;
  }

  async run(options: SubagentRunOptions): Promise<SubagentResult> {
    const agentName = options.agent ?? 'general';
    const definition = BUILTIN_AGENTS[agentName];
    if (!definition || definition.kind !== 'subagent') {
      throw new LareError('TOOL_EXECUTION_FAILED', `"${agentName}" is not a subagent`);
    }
    const depth = options.depth ?? 0;
    const maxDepth = this.options.maxDepth ?? 1;
    if (depth >= maxDepth) {
      throw new LareError(
        'TOOL_EXECUTION_FAILED',
        `subagent depth limit reached (max ${maxDepth})`
      );
    }
    if (options.signal?.aborted) {
      throw new LareError('CANCELLED', 'subagent cancelled before start');
    }
    const maxConcurrent = this.options.maxConcurrent ?? 3;
    if (this.active >= maxConcurrent) {
      throw new LareError(
        'TOOL_EXECUTION_FAILED',
        `subagent concurrency limit reached (max ${maxConcurrent})`
      );
    }

    this.active += 1;
    try {
      const loop = this.options.createLoop
        ? this.options.createLoop(options)
        : new AgentLoop({
            provider: options.provider,
            model: options.model,
            maxIterations: options.maxIterations ?? SUBAGENT_DEFAULTS.maxIterations,
            maxToolCalls: (options.maxIterations ?? SUBAGENT_DEFAULTS.maxIterations) * 4,
            tokenBudget: options.tokenBudget ?? SUBAGENT_DEFAULTS.tokenBudget,
            durationBudget: options.durationBudget ?? SUBAGENT_DEFAULTS.durationBudget,
            abortSignal: options.signal,
            providers: this.options.providers,
          });
      let text = '';
      for await (const chunk of loop.run(`${definition.systemPrompt}\n\n${options.prompt}`)) {
        text += chunk;
      }
      if (options.signal?.aborted) {
        throw new LareError('CANCELLED', 'subagent cancelled');
      }
      return {
        agent: agentName,
        depth,
        text: compressResult(text, options.compressTo ?? SUBAGENT_DEFAULTS.compressTo),
        tokens: loop.getUsage().totalTokens.total,
        haltReason: loop.getHaltReason(),
      };
    } finally {
      this.active -= 1;
    }
  }
}
