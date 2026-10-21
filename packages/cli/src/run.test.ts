import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HaltReason, UsageAggregate } from '@larecode/core';
import { runTask, type LoopLike, type RunTaskDeps, type RunTaskOptions } from './run.js';
import type { TestRun } from './verify.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'larecode-run-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function usage(total: number): UsageAggregate {
  return {
    totalTokens: { input: total, output: 0, total },
    totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    byModel: {},
    conversationId: 'test',
    startedAt: 0,
    updatedAt: 0,
  };
}

function fakeLoop(
  chunks: string[],
  options: { halt?: HaltReason | null; error?: Error; total?: number } = {}
): LoopLike & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async *run(prompt: string) {
      prompts.push(prompt);
      if (options.error) throw options.error;
      for (const chunk of chunks) yield chunk;
    },
    getUsage: () => usage(options.total ?? 120),
    getHaltReason: () => options.halt ?? null,
  };
}

function sequenceRuns(...runs: TestRun[]): () => TestRun {
  let index = 0;
  return () => runs[Math.min(index++, runs.length - 1)];
}

async function invoke(
  options: RunTaskOptions,
  deps: RunTaskDeps = {}
): Promise<{ result: Awaited<ReturnType<typeof runTask>>; output: string }> {
  const lines: string[] = [];
  const result = await runTask(options, {
    cwd: dir,
    write: (text) => lines.push(text),
    ...deps,
  });
  return {
    result,
    output: lines.join('').replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), ''),
  };
}

const testsRun = (output: string, exitCode: number): TestRun => ({
  command: 'bun run test',
  exitCode,
  output,
});

describe('runTask', () => {
  it('streams the answer, prints a summary, and exits zero', async () => {
    const loop = fakeLoop(['Hel', 'lo'], { total: 42 });
    const { result, output } = await invoke({ task: 'fix the bug' }, { createLoop: () => loop });
    expect(result.exitCode).toBe(0);
    expect(loop.prompts).toEqual(['fix the bug']);
    expect(output).toContain('Hello');
    expect(output).toContain('42 tokens');
  });

  it('emits a single JSON object in json mode', async () => {
    const loop = fakeLoop(['Hel', 'lo'], { total: 42 });
    const { result, output } = await invoke({ task: 'go', json: true }, { createLoop: () => loop });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      text: 'Hello',
      halt: null,
      exitCode: 0,
      usage: { totalTokens: { total: 42 } },
    });
  });

  it('exits three when a turn halts before finishing', async () => {
    const loop = fakeLoop(['partial'], { halt: 'budget' });
    const { result, output } = await invoke({ task: 'go' }, { createLoop: () => loop });
    expect(result.exitCode).toBe(3);
    expect(output).toContain('halted: budget');
  });

  it('exits 130 when a turn is cancelled', async () => {
    const error = Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
    const { result } = await invoke({ task: 'go' }, { createLoop: () => fakeLoop([], { error }) });
    expect(result.exitCode).toBe(130);
  });

  it('exits one when the agent fails', async () => {
    const loop = fakeLoop([], { error: new Error('provider exploded') });
    const { result, output } = await invoke({ task: 'go' }, { createLoop: () => loop });
    expect(result.exitCode).toBe(1);
    expect(output).toContain('provider exploded');
  });

  it('passes when failures stay inside the baseline', async () => {
    const runs = sequenceRuns(
      testsRun('× suite > old bug 5ms', 1),
      testsRun('× suite > old bug 3ms', 1)
    );
    const { result, output } = await invoke(
      { task: 'try a fix', verify: true },
      { createLoop: () => fakeLoop(['done']), runTests: runs, detectTests: () => 'bun run test' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.verify?.passed).toBe(true);
    expect(output).toContain('verify: baseline 1 failing');
    expect(output).toContain('verify: pass');
  });

  it('fails when a new test failure appears', async () => {
    const runs = sequenceRuns(
      testsRun('× suite > old bug 5ms', 1),
      testsRun('× suite > old bug 5ms\n× suite > regression 7ms', 1)
    );
    const { result, output } = await invoke(
      { task: 'break things', verify: true },
      { createLoop: () => fakeLoop(['done']), runTests: runs, detectTests: () => 'bun run test' }
    );
    expect(result.exitCode).toBe(1);
    expect(result.verify?.newFailures).toEqual(['suite > regression']);
    expect(output).toContain('verify: 1 new failing');
    expect(output).toContain('verify: fail');
  });

  it('reports fixed tests without failing', async () => {
    const runs = sequenceRuns(testsRun('× a 1ms\n× b 1ms', 1), testsRun('All 10 passed', 0));
    const { result, output } = await invoke(
      { task: 'fix all', verify: true },
      { createLoop: () => fakeLoop(['done']), runTests: runs, detectTests: () => 'bun run test' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.verify?.fixedFailures).toEqual(['a', 'b']);
    expect(output).toContain('verify: 2 fixed');
  });

  it('fails fast when verify finds no test script', async () => {
    const { result, output } = await invoke(
      { task: 'x', verify: true },
      { detectTests: () => null }
    );
    expect(result.exitCode).toBe(1);
    expect(output).toContain('no test script found');
  });
});
