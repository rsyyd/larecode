import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lumpscodeHome } from '../config/config.js';
import { LumpsError } from '../error/error.js';
import {
  assertPreAuthorizable,
  Permissions,
  type PermissionGroup,
} from '../permission/permission.js';
import { nextRun, parseSchedule } from './schedule.js';

export const CRON_OUTPUT_MAX_CHARS = 20_000;

export interface CronResult {
  at: Date;
  status: 'ok' | 'error';
  output: string;
  error?: string;
  tokens: number;
  cost: number;
  halt: string | null;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  policy: PermissionGroup[];
  enabled: boolean;
  createdAt: Date;
  nextRun?: Date;
  lastRun?: Date;
  lastResult?: CronResult;
}

export interface CronJobInput {
  schedule: string;
  prompt: string;
  name?: string;
  policy?: PermissionGroup[];
}

interface StoredJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  policy: string[];
  enabled: boolean;
  createdAt: string;
  nextRun?: string;
  lastRun?: string;
  lastResult?: {
    at: string;
    status: CronResult['status'];
    output: string;
    error?: string;
    tokens: number;
    cost: number;
    halt?: string | null;
  };
}

export function cronPath(): string {
  return join(lumpscodeHome(), 'cron.json');
}

export function cronPermissions(job: CronJob): Permissions {
  return new Permissions({
    mode: 'ask',
    allowedGroups: [],
    preAuthorized: { [`cron:${job.id}`]: job.policy },
  });
}

export class Jobs {
  constructor(private readonly file: string = cronPath()) {}

  private read(): CronJob[] {
    if (!existsSync(this.file)) return [];
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredJob[];
      if (!Array.isArray(stored)) return [];
      return stored.map((entry) => toJob(entry)).filter((job): job is CronJob => job !== undefined);
    } catch {
      return [];
    }
  }

  private write(jobs: CronJob[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(jobs.map(toStored), null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }

  add(input: CronJobInput): CronJob {
    const schedule = input.schedule.trim();
    const parsed = parseSchedule(schedule);
    const prompt = input.prompt.trim();
    if (!prompt) throw new LumpsError('CONFIG_INVALID', 'cron job needs a prompt');
    const policy = assertPreAuthorizable(input.policy ?? []);
    const id = randomBytes(4).toString('hex');
    const job: CronJob = {
      id,
      name: input.name?.trim() || `job-${id}`,
      schedule,
      prompt,
      policy,
      enabled: true,
      createdAt: new Date(),
      nextRun: nextRun(parsed, new Date()),
    };
    this.write([...this.read(), job]);
    return job;
  }

  get(id: string): CronJob | undefined {
    return this.read().find((job) => job.id === id);
  }

  list(): CronJob[] {
    return this.read();
  }

  remove(id: string): boolean {
    const jobs = this.read();
    const remaining = jobs.filter((job) => job.id !== id);
    if (remaining.length === jobs.length) return false;
    this.write(remaining);
    return true;
  }

  due(now: Date): CronJob[] {
    return this.list().filter(
      (job) => job.enabled && job.nextRun !== undefined && job.nextRun.getTime() <= now.getTime()
    );
  }

  nextRunAt(): Date | undefined {
    const times = this.list()
      .filter((job) => job.enabled && job.nextRun !== undefined)
      .map((job) => job.nextRun!.getTime());
    return times.length > 0 ? new Date(Math.min(...times)) : undefined;
  }

  record(id: string, result: CronResult): CronJob | undefined {
    const jobs = this.read();
    const job = jobs.find((entry) => entry.id === id);
    if (!job) return undefined;
    job.lastRun = result.at;
    job.lastResult = { ...result, output: tail(result.output, CRON_OUTPUT_MAX_CHARS) };
    job.nextRun = nextRun(parseSchedule(job.schedule), result.at);
    this.write(jobs);
    return job;
  }
}

function tail(output: string, max: number): string {
  return output.length <= max ? output : `[...]\n${output.slice(output.length - max)}`;
}

function toJob(entry: StoredJob): CronJob | undefined {
  if (typeof entry?.id !== 'string' || typeof entry?.schedule !== 'string') return undefined;
  try {
    const job: CronJob = {
      id: entry.id,
      name: entry.name ?? `job-${entry.id}`,
      schedule: entry.schedule,
      prompt: entry.prompt ?? '',
      policy: (entry.policy ?? []) as PermissionGroup[],
      enabled: entry.enabled ?? true,
      createdAt: new Date(entry.createdAt),
    };
    if (entry.nextRun) job.nextRun = new Date(entry.nextRun);
    if (entry.lastRun) job.lastRun = new Date(entry.lastRun);
    if (entry.lastResult) {
      job.lastResult = {
        at: new Date(entry.lastResult.at),
        status: entry.lastResult.status,
        output: entry.lastResult.output,
        error: entry.lastResult.error,
        tokens: entry.lastResult.tokens,
        cost: entry.lastResult.cost,
        halt: entry.lastResult.halt ?? null,
      };
    }
    if (!job.nextRun) job.nextRun = nextRun(parseSchedule(job.schedule), new Date());
    return job;
  } catch {
    return undefined;
  }
}

function toStored(job: CronJob): StoredJob {
  const stored: StoredJob = {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    prompt: job.prompt,
    policy: job.policy,
    enabled: job.enabled,
    createdAt: job.createdAt.toISOString(),
  };
  if (job.nextRun) stored.nextRun = job.nextRun.toISOString();
  if (job.lastRun) stored.lastRun = job.lastRun.toISOString();
  if (job.lastResult) {
    stored.lastResult = {
      at: job.lastResult.at.toISOString(),
      status: job.lastResult.status,
      output: job.lastResult.output,
      error: job.lastResult.error,
      tokens: job.lastResult.tokens,
      cost: job.lastResult.cost,
      halt: job.lastResult.halt,
    };
  }
  return stored;
}
