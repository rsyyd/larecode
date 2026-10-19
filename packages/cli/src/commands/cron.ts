import {
  AgentLoop,
  Jobs,
  loadEffectiveConfig,
  runCronJob,
  runScheduler,
  type CronJob,
  type CronLoop,
  type CronResult,
  type PermissionGroup,
  type SchedulerDeps,
} from '@lumpscode/core';

export interface CronAddOptions {
  schedule: string;
  prompt: string[];
  name?: string;
  allow?: string;
}

export interface CronDeps {
  jobs?: Jobs;
  createLoop?: (options: {
    provider: string;
    model: string;
    abortSignal?: AbortSignal;
  }) => CronLoop;
  loadConfig?: (cwd?: string) => { defaultProvider: string; defaultModel: string };
  signal?: AbortSignal;
  wait?: SchedulerDeps['wait'];
  now?: () => Date;
  write?: (text: string) => void;
}

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;
const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;

const stamp = (date: Date) => date.toISOString().replace('T', ' ').slice(0, 16);

function defaultLoop(options: {
  provider: string;
  model: string;
  abortSignal?: AbortSignal;
}): CronLoop {
  return new AgentLoop({
    provider: options.provider,
    model: options.model,
    maxIterations: 40,
    maxToolCalls: 200,
    tokenBudget: 200_000,
    durationBudget: 600_000,
    abortSignal: options.abortSignal,
  });
}

function parseAllow(allow?: string): PermissionGroup[] {
  if (!allow) return [];
  return allow
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group.length > 0) as PermissionGroup[];
}

export function cronAdd(options: CronAddOptions, deps: CronDeps = {}): number {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const jobs = deps.jobs ?? new Jobs();
  try {
    const job = jobs.add({
      schedule: options.schedule,
      prompt: options.prompt.join(' '),
      name: options.name,
      policy: parseAllow(options.allow),
    });
    const policy = job.policy.length > 0 ? job.policy.join(',') : 'none';
    write(
      `${ok('added')} ${job.id} ${dim('·')} ${job.name} ${dim('·')} ${job.schedule} ${dim('·')} next ${stamp(job.nextRun!)} ${dim('·')} policy ${policy}\n`
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`${bad('cron:')} ${message}\n`);
    return 1;
  }
}

function lastLine(job: CronJob): string {
  if (!job.lastResult) return `${dim('last never')}`;
  const first = job.lastResult.output.split('\n').find((line) => line.trim().length > 0) ?? '';
  const tail = first.length > 60 ? `${first.slice(0, 60)}...` : first;
  return `${job.lastResult.status === 'ok' ? ok('last ok') : bad('last error')} ${dim(stamp(job.lastResult.at))} ${dim(tail)}`;
}

export function cronList(deps: CronDeps = {}): number {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const jobs = (deps.jobs ?? new Jobs()).list();
  if (jobs.length === 0) {
    write(`${dim('no cron jobs')}\n`);
    return 0;
  }
  for (const job of jobs) {
    write(
      `${job.id}  ${job.name}  ${dim('·')} ${job.schedule} ${dim('·')} next ${job.nextRun ? stamp(job.nextRun) : '-'} ${dim('·')} ${lastLine(job)}\n`
    );
  }
  return 0;
}

export function cronRemove(id: string, deps: CronDeps = {}): number {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const jobs = deps.jobs ?? new Jobs();
  if (!jobs.remove(id)) {
    write(`${bad('cron:')} job ${id} not found\n`);
    return 1;
  }
  write(`${ok('removed')} ${id}\n`);
  return 0;
}

export async function cronRun(id: string, deps: CronDeps = {}): Promise<number> {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const jobs = deps.jobs ?? new Jobs();
  const job = jobs.get(id);
  if (!job) {
    write(`${bad('cron:')} job ${id} not found\n`);
    return 1;
  }
  write(
    `${dim(`running ${job.name} (${job.schedule}) unattended · policy ${job.policy.join(',') || 'none'}`)}\n\n`
  );
  const result = await runCronJob(job, {
    createLoop: deps.createLoop ?? defaultLoop,
    loadConfig: deps.loadConfig ?? loadEffectiveConfig,
    signal: deps.signal,
    onChunk: write,
  });
  jobs.record(job.id, result);
  write(`\n${summarize(result)}\n`);

  if (result.status === 'error') {
    write(`${bad('cron:')} job failed: ${result.error ?? 'unknown error'}\n`);
  }
  return result.status === 'ok' ? 0 : 1;
}

function summarize(result: CronResult): string {
  const status = result.status === 'ok' ? ok('ok') : bad('error');
  const halt = result.halt ? ` ${dim('·')} halted ${result.halt}` : '';
  return `${status} ${dim(stamp(result.at))} ${dim('·')} ${result.tokens} tokens ${dim('·')} $${result.cost.toFixed(4)}${halt}`;
}

export async function cronStart(deps: CronDeps = {}): Promise<number> {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const jobs = deps.jobs ?? new Jobs();
  const controller = new AbortController();
  const signal = deps.signal ?? controller.signal;
  if (!deps.signal) {
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
  }

  const jobCount = jobs.list().filter((job) => job.enabled).length;
  write(`${dim(`cron: scheduler started with ${jobCount} job(s)`)}\n`);

  await runScheduler({
    jobs,
    signal,
    now: deps.now,
    wait: deps.wait,
    run: (job) =>
      runCronJob(job, {
        createLoop: deps.createLoop ?? defaultLoop,
        loadConfig: deps.loadConfig ?? loadEffectiveConfig,
        signal,
      }),
    onResult: (job, result) => {
      write(`${dim(stamp(result.at))} ${job.name} ${summarize(result)}\n`);
      const first = result.output.split('\n').find((line) => line.trim().length > 0) ?? '';
      if (first) write(`${dim(`  ${first}`)}\n`);
    },
  });

  write(`${dim('cron: scheduler stopped')}\n`);
  return 0;
}
