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
}

export async function runCronJob(job: CronJob, deps: CronRunDeps = {}): Promise<CronResult> {
  const now = deps.now ?? (() => new Date());
  const config = (deps.loadConfig ?? loadEffectiveConfig)(deps.cwd);
  const createLoop =
    deps.createLoop ??
    ((options) => {
      throw new Error(`no loop factory configured for ${options.model}`);
    });
  const loop = createLoop({
    provider: config.defaultProvider,
    model: config.defaultModel,
    workingDir: deps.cwd,
    permissions: cronPermissions(job),
    unattended: true,
    abortSignal: deps.signal,
  });

  let output = '';
  let failure: string | undefined;
  try {
    for await (const chunk of loop.run(job.prompt)) {
      output += chunk;
      deps.onChunk?.(chunk);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const usage = loop.getUsage();
  return {
    at: now(),
    status: failure === undefined ? 'ok' : 'error',
    output: output.slice(-CRON_OUTPUT_MAX_CHARS),
    error: failure,
    tokens: usage.totalTokens.total,
    cost: usage.totalCost.totalCost,
    halt: loop.getHaltReason(),
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
