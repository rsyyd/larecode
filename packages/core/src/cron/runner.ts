import { loadEffectiveConfig } from '../config/config.js';
import type { Permissions } from '../permission/permission.js';
import type { UsageAggregate } from '../usage/usage.js';
import type { HaltReason } from '../agent/loop.js';
import {
  CRON_OUTPUT_MAX_CHARS,
  cronPermissions,
  type CronJob,
  type CronResult,
  type Jobs,
} from './job.js';

export interface CronLoop {
  run(prompt: string): AsyncGenerator<string>;
  getUsage(): UsageAggregate;
  getHaltReason(): HaltReason | null;
}

export interface CronRunDeps {
  createLoop?: (options: {
    provider: string;
    model: string;
    workingDir?: string;
    permissions?: Permissions;
    unattended?: boolean;
    abortSignal?: AbortSignal;
  }) => CronLoop;
  loadConfig?: (cwd?: string) => { defaultProvider: string; defaultModel: string };
  cwd?: string;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  now?: () => Date;
  retryDelayMs?: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCronJob(job: CronJob, deps: CronRunDeps = {}): Promise<CronResult> {
  const now = deps.now ?? (() => new Date());
  const config = (deps.loadConfig ?? loadEffectiveConfig)(deps.cwd);
  const createLoop =
    deps.createLoop ??
    ((options) => {
      throw new Error(`no loop factory configured for ${options.model}`);
    });
  const retries = Math.max(0, job.retries ?? 0);
  const timeoutMs = Math.max(1000, job.timeoutMs ?? 600_000);
  const startedAt = Date.now();
  let attempts = 0;
  let output = '';
  let failure: string | undefined;
  let halt: string | null = null;
  let tokens = 0;
  let cost = 0;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    attempts = attempt;
    if (deps.signal?.aborted) {
      failure = 'cancelled';
      break;
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
    let loop: CronLoop | undefined;
    let attemptFailure: string | undefined;
    try {
      loop = createLoop({
        provider: config.defaultProvider,
        model: config.defaultModel,
        workingDir: deps.cwd,
        permissions: cronPermissions(job),
        unattended: true,
        abortSignal: signal,
      });
      for await (const chunk of loop.run(job.prompt)) {
        output += chunk;
        deps.onChunk?.(chunk);
      }
      halt = loop.getHaltReason();
    } catch (error) {
      attemptFailure = error instanceof Error ? error.message : String(error);
    }
    if (timeout.aborted && !deps.signal?.aborted) {
      attemptFailure = `timed out after ${timeoutMs}ms`;
    }
    if (loop) {
      const usage = loop.getUsage();
      tokens += usage.totalTokens.total;
      cost += usage.totalCost.totalCost;
      halt = loop.getHaltReason();
    }
    if (attemptFailure === undefined) {
      failure = undefined;
      break;
    }
    failure = attemptFailure;
    if (deps.signal?.aborted) break;
    if (attempt <= retries) await wait(deps.retryDelayMs ?? 500);
  }

  return {
    at: now(),
    status: failure === undefined ? 'ok' : 'error',
    output: output.slice(-CRON_OUTPUT_MAX_CHARS),
    error: failure,
    tokens,
    cost,
    halt,
    attempts,
    durationMs: Date.now() - startedAt,
  };
}

export interface SchedulerDeps {
  jobs: Jobs;
  run: (job: CronJob) => Promise<CronResult>;
  signal: AbortSignal;
  now?: () => Date;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  onResult?: (job: CronJob, result: CronResult) => void;
  minDelayMs?: number;
  idleDelayMs?: number;
}

function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export async function runScheduler(deps: SchedulerDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const wait = deps.wait ?? defaultWait;
  const minDelay = deps.minDelayMs ?? 1_000;

  while (!deps.signal.aborted) {
    for (const job of deps.jobs.due(now())) {
      if (deps.signal.aborted) return;
      let result: CronResult;
      try {
        result = await deps.run(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = { at: now(), status: 'error', output: message, tokens: 0, cost: 0, halt: null };
      }
      deps.jobs.record(job.id, result);
      deps.onResult?.(job, result);
    }
    const upcoming = deps.jobs.nextRunAt();
    const delay = upcoming
      ? Math.max(minDelay, upcoming.getTime() - now().getTime())
      : (deps.idleDelayMs ?? 60_000);
    await wait(delay, deps.signal);
  }
}
