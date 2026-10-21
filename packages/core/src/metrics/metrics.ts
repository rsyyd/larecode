export interface MetricsBucket {
  calls: number;
  errors: number;
  totalMs: number;
}

export interface MetricsSnapshot {
  startedAt: number;
  turns: number;
  retries: number;
  tools: MetricsBucket & { byName: Record<string, MetricsBucket> };
  providers: MetricsBucket & { byName: Record<string, MetricsBucket> };
}

function bucket(): MetricsBucket {
  return { calls: 0, errors: 0, totalMs: 0 };
}

export class Metrics {
  private readonly startedAt = Date.now();
  private turns = 0;
  private retries = 0;
  private tools = { ...bucket(), byName: {} as Record<string, MetricsBucket> };
  private providers = { ...bucket(), byName: {} as Record<string, MetricsBucket> };

  recordTurn(): void {
    this.turns += 1;
  }

  recordRetry(): void {
    this.retries += 1;
  }

  recordTool(name: string, durationMs: number, ok: boolean): void {
    add(this.tools, durationMs, ok);
    add((this.tools.byName[name] ??= bucket()), durationMs, ok);
  }

  recordProvider(name: string, durationMs: number, ok: boolean): void {
    add(this.providers, durationMs, ok);
    add((this.providers.byName[name] ??= bucket()), durationMs, ok);
  }

  snapshot(): MetricsSnapshot {
    return {
      startedAt: this.startedAt,
      turns: this.turns,
      retries: this.retries,
      tools: { ...this.tools, byName: { ...this.tools.byName } },
      providers: { ...this.providers, byName: { ...this.providers.byName } },
    };
  }

  reset(): void {
    this.turns = 0;
    this.retries = 0;
    this.tools = { ...bucket(), byName: {} };
    this.providers = { ...bucket(), byName: {} };
  }
}

function add(target: MetricsBucket, durationMs: number, ok: boolean): void {
  target.calls += 1;
  if (!ok) target.errors += 1;
  target.totalMs += Math.max(0, durationMs);
}

export const defaultMetrics = new Metrics();
