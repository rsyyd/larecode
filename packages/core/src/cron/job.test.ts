import { mkdtemp, rm, stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LumpsError } from '../error/error.js';
import { Jobs, cronPermissions } from './job.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumps-cron-'));
  file = join(dir, 'cron.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Jobs', () => {
  it('adds, persists, and reloads jobs', async () => {
    const jobs = new Jobs(file);
    const job = jobs.add({
      schedule: 'every 30 minutes',
      prompt: 'audit the repo',
      name: 'nightly audit',
      policy: ['read', 'network'],
    });
    expect(job.id).toMatch(/^[0-9a-f]{8}$/);
    expect(job.nextRun).toBeInstanceOf(Date);

    const reloaded = new Jobs(file);
    const stored = reloaded.get(job.id);
    expect(stored?.name).toBe('nightly audit');
    expect(stored?.prompt).toBe('audit the repo');
    expect(stored?.policy).toEqual(['read', 'network']);

    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(1);
  });

  it('defaults the name and dedupes policy', () => {
    const jobs = new Jobs(file);
    const job = jobs.add({ schedule: 'hourly', prompt: 'ping', policy: ['read', 'read'] });
    expect(job.name).toBe(`job-${job.id}`);
    expect(job.policy).toEqual(['read']);
  });

  it('rejects bad schedules and policies', () => {
    const jobs = new Jobs(file);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as LumpsError).code;
      }
      return undefined;
    };
    expect(code(() => jobs.add({ schedule: 'whenever', prompt: 'x' }))).toBe(
      'CRON_INVALID_SCHEDULE'
    );
    expect(code(() => jobs.add({ schedule: 'hourly', prompt: 'x', policy: ['destructive'] }))).toBe(
      'PERMISSION_DENIED'
    );
    expect(code(() => jobs.add({ schedule: 'hourly', prompt: 'x', policy: ['secrets'] }))).toBe(
      'PERMISSION_DENIED'
    );
    expect(
      code(() => jobs.add({ schedule: 'hourly', prompt: 'x', policy: ['foo'] as never }))
    ).toBe('CONFIG_INVALID');
    expect(jobs.list()).toHaveLength(0);
  });

  it('tracks due jobs and records results', () => {
    const jobs = new Jobs(file);
    const job = jobs.add({ schedule: 'every 30 minutes', prompt: 'x' });
    const future = new Date(Date.now() + 3_600_000);
    expect(jobs.due(new Date())).toHaveLength(0);
    expect(jobs.due(future).map((due) => due.id)).toEqual([job.id]);
    expect(jobs.nextRunAt()).toEqual(job.nextRun);

    const result = {
      at: future,
      status: 'ok' as const,
      output: 'all good',
      tokens: 12,
      cost: 0.002,
      halt: null,
    };
    const recorded = jobs.record(job.id, result);
    expect(recorded?.lastResult?.output).toBe('all good');
    expect(recorded?.lastRun).toEqual(future);
    expect(recorded?.nextRun && recorded.nextRun.getTime()).toBeGreaterThan(future.getTime());
    expect(new Jobs(file).get(job.id)?.lastResult?.tokens).toBe(12);
  });

  it('removes jobs', () => {
    const jobs = new Jobs(file);
    const job = jobs.add({ schedule: 'hourly', prompt: 'x' });
    expect(jobs.remove(job.id)).toBe(true);
    expect(jobs.remove(job.id)).toBe(false);
    expect(jobs.get(job.id)).toBeUndefined();
  });

  it('caps stored output from the tail', () => {
    const jobs = new Jobs(file);
    const job = jobs.add({ schedule: 'hourly', prompt: 'x' });
    const output = 'x'.repeat(50_000) + 'THE-END';
    jobs.record(job.id, { at: new Date(), status: 'ok', output, tokens: 0, cost: 0, halt: null });
    const stored = jobs.get(job.id)?.lastResult?.output ?? '';
    expect(stored).toContain('THE-END');
    expect(stored.length).toBeLessThan(output.length);
  });
});

describe('cronPermissions', () => {
  const job = (policy: string[]) => ({
    id: 'abc',
    name: 'j',
    schedule: 'hourly',
    prompt: 'x',
    policy: policy as never,
    enabled: true,
    createdAt: new Date(),
  });

  it('pre-authorizes exactly the scheduled bundle', () => {
    const permissions = cronPermissions(job(['read', 'network']));
    expect(permissions.check('read', { unattended: true }).allowed).toBe(true);
    expect(permissions.check('network', { unattended: true }).allowed).toBe(true);
    expect(permissions.check('shell', { unattended: true }).allowed).toBe(false);
  });

  it('never allows destructive or secrets even if smuggled in', () => {
    const permissions = cronPermissions(job(['read', 'destructive', 'secrets']));
    expect(permissions.check('destructive', { unattended: true }).allowed).toBe(false);
    expect(permissions.check('secrets', { unattended: true }).allowed).toBe(false);
  });
});
