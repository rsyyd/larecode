export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface CostUsage {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface UsageSnapshot {
  model: string;
  provider: string;
  totalTokens: TokenUsage;
  totalCost: CostUsage;
  timestamp: number;
}

export interface UsageAggregate {
  totalTokens: TokenUsage;
  totalCost: CostUsage;
  byModel: Record<string, UsageSnapshot>;
  conversationId: string;
  startedAt: number;
  updatedAt: number;
}

export interface UsageRecorder {
  record(tokens: TokenUsage, cost: CostUsage, model: string, provider: string): void;
  getSnapshot(): UsageSnapshot;
  getAggregate(): UsageAggregate;
  reset(): void;
}

export class InMemoryUsageRecorder implements UsageRecorder {
  private snapshots: UsageSnapshot[] = [];
  private aggregate: UsageAggregate;

  constructor(conversationId: string) {
    this.aggregate = {
      totalTokens: { input: 0, output: 0, total: 0 },
      totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      byModel: {},
      conversationId,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  record(tokens: TokenUsage, cost: CostUsage, model: string, provider: string): void {
    const snapshot: UsageSnapshot = {
      model,
      provider,
      totalTokens: { ...tokens },
      totalCost: { ...cost },
      timestamp: Date.now(),
    };
    this.snapshots.push(snapshot);

    this.aggregate.totalTokens.input += tokens.input;
    this.aggregate.totalTokens.output += tokens.output;
    this.aggregate.totalTokens.total += tokens.total;
    this.aggregate.totalCost.inputCost += cost.inputCost;
    this.aggregate.totalCost.outputCost += cost.outputCost;
    this.aggregate.totalCost.totalCost += cost.totalCost;

    const key = `${provider}:${model}`;
    if (!this.aggregate.byModel[key]) {
      this.aggregate.byModel[key] = {
        model,
        provider,
        totalTokens: { input: 0, output: 0, total: 0 },
        totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
        timestamp: Date.now(),
      };
    }
    const existing = this.aggregate.byModel[key];
    existing.totalTokens.input += tokens.input;
    existing.totalTokens.output += tokens.output;
    existing.totalTokens.total += tokens.total;
    existing.totalCost.inputCost += cost.inputCost;
    existing.totalCost.outputCost += cost.outputCost;
    existing.totalCost.totalCost += cost.totalCost;
    existing.timestamp = Date.now();

    this.aggregate.updatedAt = Date.now();
  }

  getSnapshot(): UsageSnapshot {
    const last = this.snapshots[this.snapshots.length - 1];
    if (!last) {
      return {
        model: '',
        provider: '',
        totalTokens: { input: 0, output: 0, total: 0 },
        totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
        timestamp: Date.now(),
      };
    }
    return { ...last };
  }

  getAggregate(): UsageAggregate {
    return {
      ...this.aggregate,
      totalTokens: { ...this.aggregate.totalTokens },
      totalCost: { ...this.aggregate.totalCost },
      byModel: Object.fromEntries(
        Object.entries(this.aggregate.byModel).map(([k, v]) => [k, { ...v }])
      ),
    };
  }

  reset(): void {
    this.snapshots = [];
    this.aggregate = {
      totalTokens: { input: 0, output: 0, total: 0 },
      totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      byModel: {},
      conversationId: this.aggregate.conversationId,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export function createUsageRecorder(conversationId: string): UsageRecorder {
  return new InMemoryUsageRecorder(conversationId);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(
  tokens: TokenUsage,
  model: string,
  pricing: Record<string, { inputPer1k: number; outputPer1k: number }>
): CostUsage {
  const p = pricing[model] ?? { inputPer1k: 0, outputPer1k: 0 };
  const inputCost = (tokens.input / 1000) * p.inputPer1k;
  const outputCost = (tokens.output / 1000) * p.outputPer1k;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

export const DEFAULT_MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'claude-3-5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-5-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  'gemini-1.5-pro': { inputPer1k: 0.0035, outputPer1k: 0.0105 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
};
