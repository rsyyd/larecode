import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Jobs, type CronLoop } from '@lumpscode/core';
import {
  cronAdd,
  cronList,
  cronRemove,
  cronRun,
  cronStart,
  type CronDeps,
} from './commands/cron.js';

let dir: string;
let jobs: Jobs;

const config = { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' };

function fakeLoop(chunks: string[]): CronLoop {
  return {
    async *run() {
      for (const chunk of chunks) yield chunk;
    },
    getUsage: () => ({ totalTokens: { total: 5 }, totalCost: { totalCost: 0.001 } }),
    getHaltReason: () => null,
  } as unknown as CronLoop;
}

function harness(overrides: Partial<CronDeps> = {}) {
  const out: string[] = [];
  const deps: CronDeps = {
    jobs,
    loadConfig: () => config,
    createLoop: () => fakeLoop(['done']),
    write: (text) => out.push(text),
    ...overrides,
  };
  return { deps, out: () => out.join('') };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumps-cron-cli-'));
  jobs = new Jobs(join(dir, 'cron.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('cron add/list/remove', () => {
  it('round-trips a job through the commands', () => {
    const add = harness();
    expect(
      cronAdd(
        {
          schedule: 'every 30 minutes',
          prompt: ['audit', 'the repo'],
          name: 'audit',
          allow: 'read,network',
        },
        add.deps
      )
    ).toBe(0);
    const plain = add.out().replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
    const id = /added ([0-9a-f]{8})/.exec(plain)?.[1] ?? '';
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(plain).toContain('policy read,network');
    expect(jobs.get(id)?.prompt).toBe('audit the repo');

    const list = harness();
    expect(cronList(list.deps)).toBe(0);
    expect(list.out()).toContain('audit');
    expect(list.out()).toContain('last never');

    const remove = harness();
    expect(cronRemove(id, remove.deps)).toBe(0);
    expect(cronRemove(id, remove.deps)).toBe(1);
  });

  it('rejects bad schedules and policies', () => {
    const bad = harness();
    expect(cronAdd({ schedule: 'whenever', prompt: ['x'] }, bad.deps)).toBe(1);
    expect(bad.out()).toContain('invalid schedule');

    const denied = harness();
    expect(
      cronAdd({ schedule: 'hourly', prompt: ['x'], allow: 'read,destructive' }, denied.deps)
    ).toBe(1);
    expect(denied.out()).toContain('never pre-authorizable');
    expect(jobs.list()).toHaveLength(0);
  });

  it('lists nothing when empty', () => {
    const list = harness();
    expect(cronList(list.deps)).toBe(0);
    expect(list.out()).toContain('no cron jobs');
  });
});

describe('cron run', () => {
  it('runs a job unattended and records the result', async () => {
    const id = jobs.add({ schedule: 'hourly', prompt: 'ping' }).id;
    const run = harness({ createLoop: () => fakeLoop(['all ', 'good']) });
    expect(await cronRun(id, run.deps)).toBe(0);
    expect(run.out()).toContain('all good');
    expect(run.out()).toContain('5 tokens');
    expect(jobs.get(id)?.lastResult?.output).toBe('all good');
  });

  it('reports failures and unknown ids', async () => {
    const id = jobs.add({ schedule: 'hourly', prompt: 'ping' }).id;
    const failing = harness({
      createLoop: () =>
        ({
          async *run() {
            yield 'starting ';
            throw new Error('no provider');
          },
          getUsage: () => ({ totalTokens: { total: 0 }, totalCost: { totalCost: 0 } }),
          getHaltReason: () => null,
        }) as unknown as CronLoop,
    });
    expect(await cronRun(id, failing.deps)).toBe(1);
    expect(failing.out()).toContain('no provider');
    expect(jobs.get(id)?.lastResult?.status).toBe('error');

    const missing = harness();
    expect(await cronRun('deadbeef', missing.deps)).toBe(1);
  });
});

describe('cron start', () => {
  it('executes due jobs until the signal aborts', async () => {
    const id = jobs.add({ schedule: 'every 30 minutes', prompt: 'ping' }).id;
    const controller = new AbortController();
    const future = new Date(Date.now() + 3_600_000);
    const run = harness({
      signal: controller.signal,
      now: () => future,
      wait: async () => {
        controller.abort();
      },
      createLoop: () => fakeLoop(['scheduled output']),
    });
    expect(await cronStart(run.deps)).toBe(0);
    expect(run.out()).toContain('scheduler started with 1 job(s)');
    expect(run.out()).toContain('scheduled output');
    expect(jobs.get(id)?.lastResult?.output).toBe('scheduled output');
  });
});
