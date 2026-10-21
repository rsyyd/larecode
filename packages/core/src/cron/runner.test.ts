import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Jobs } from './job.js';
import { runCronJob, runScheduler, type CronLoop } from './runner.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-cron-'));
  file = join(dir, 'cron.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeLoop(chunks: string[], usage = { total: 42, totalCost: 0.004 }): CronLoop {
  return {
    async *run() {
      for (const chunk of chunks) yield chunk;
    },
    getUsage: () => ({
      totalTokens: { input: usage.total, output: usage.total, total: usage.total },
      totalCost: { totalCost: usage.totalCost },
    }),
    getHaltReason: () => null,
  } as unknown as CronLoop;
}

describe('runCronJob', () => {
  const job = {
    id: 'abc12345',
    name: 'audit',
    schedule: 'hourly',
    prompt: 'audit the repo',
    policy: ['read'] as never,
    enabled: true,
    createdAt: new Date(),
  };

  it('runs unattended and reports usage', async () => {
    const chunks: string[] = [];
    const result = await runCronJob(job, {
      loadConfig: () => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }),
      createLoop: (options) => {
        expect(options.unattended).toBe(true);
        expect(options.permissions?.check('read', { unattended: true }).allowed).toBe(true);
        expect(options.permissions?.check('shell', { unattended: true }).allowed).toBe(false);
        return fakeLoop(['he', 'llo']);
      },
      onChunk: (text) => chunks.push(text),
    });
    expect(result.status).toBe('ok');
    expect(result.output).toBe('hello');
    expect(result.tokens).toBe(42);
    expect(result.cost).toBe(0.004);
    expect(chunks).toEqual(['he', 'llo']);
  });

  it('captures failures with partial output', async () => {
    const result = await runCronJob(job, {
      loadConfig: () => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }),
      createLoop: () =>
        ({
          async *run() {
            yield 'partial ';
            throw new Error('provider exploded');
          },
          getUsage: () => ({
            totalTokens: { input: 0, output: 0, total: 0 },
            totalCost: { totalCost: 0 },
          }),
          getHaltReason: () => null,
        }) as unknown as CronLoop,
    });
    expect(result.status).toBe('error');
    expect(result.output).toBe('partial ');
    expect(result.error).toContain('provider exploded');
  });

  it('retries failed attempts before giving up', async () => {
    let attempts = 0;
    const result = await runCronJob(
      { ...job, retries: 2 },
      {
        loadConfig: () => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }),
        retryDelayMs: 0,
        createLoop: () => {
          attempts += 1;
          if (attempts === 1) {
            return {
              // oxlint-disable-next-line require-yield
              async *run() {
                throw new Error('transient');
              },
              getUsage: () => ({
                totalTokens: { input: 0, output: 0, total: 0 },
                totalCost: { totalCost: 0 },
              }),
              getHaltReason: () => null,
            } as unknown as CronLoop;
          }
          return fakeLoop(['ok']);
        },
      }
    );
    expect(result.status).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(result.output).toBe('ok');
  });

  it('aborts a run that exceeds its timeout', async () => {
    const result = await runCronJob(
      { ...job, timeoutMs: 1000 },
      {
        loadConfig: () => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }),
        createLoop: (options) =>
          ({
            async *run() {
              yield 'start';
              await new Promise((_, reject) => {
                options.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
                  once: true,
                });
              });
            },
            getUsage: () => ({
              totalTokens: { input: 0, output: 0, total: 0 },
              totalCost: { totalCost: 0 },
            }),
            getHaltReason: () => null,
          }) as unknown as CronLoop,
      }
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
  }, 10_000);
});

describe('runScheduler', () => {
  it('runs due jobs once, records them, and stops on abort', async () => {
    const jobs = new Jobs(file);
    const job = jobs.add({ schedule: 'every 30 minutes', prompt: 'ping' });
    const controller = new AbortController();
    const runs: string[] = [];
    const results: string[] = [];
    const future = new Date(Date.now() + 3_600_000);
    let waits = 0;

    await runScheduler({
      jobs,
      signal: controller.signal,
      now: () => future,
      wait: async (ms, signal) => {
        waits += 1;
        expect(ms).toBeGreaterThan(0);
        expect(signal).toBe(controller.signal);
        controller.abort();
      },
      run: async (due) => {
        runs.push(due.id);
        return { at: future, status: 'ok', output: 'pong', tokens: 1, cost: 0, halt: null };
      },
      onResult: (due, result) => results.push(`${due.id}:${result.status}`),
    });

    expect(runs).toEqual([job.id]);
    expect(results).toEqual([`${job.id}:ok`]);
    expect(waits).toBe(1);
    expect(jobs.get(job.id)?.lastResult?.output).toBe('pong');
  });

  it('idles when nothing is scheduled', async () => {
    const jobs = new Jobs(file);
    const controller = new AbortController();
    let waited = 0;
    await runScheduler({
      jobs,
      signal: controller.signal,
      wait: async (ms) => {
        waited = ms;
        controller.abort();
      },
      run: async () => {
        throw new Error('should not run');
      },
    });
    expect(waited).toBe(60_000);
  });

  it('turns a throwing run into an error result', async () => {
    const jobs = new Jobs(file);
    const job = jobs.add({ schedule: 'every 30 minutes', prompt: 'ping' });
    const controller = new AbortController();
    const future = new Date(Date.now() + 3_600_000);
    await runScheduler({
      jobs,
      signal: controller.signal,
      now: () => future,
      wait: async () => controller.abort(),
      run: async () => {
        throw new Error('boom');
      },
    });
    expect(jobs.get(job.id)?.lastResult?.status).toBe('error');
    expect(jobs.get(job.id)?.lastResult?.output).toBe('boom');
  });
});
