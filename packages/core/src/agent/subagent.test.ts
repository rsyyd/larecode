import { describe, expect, it } from 'vitest';
import { compressResult, Subagents, type SubagentLoopLike } from './subagent.js';
import { taskTool } from '../tool/task.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Permissions, type PermissionPolicy } from '../permission/permission.js';
import { Logger } from '../logger/logger.js';
import { LumpsError } from '../error/error.js';
import type { HaltReason } from './loop.js';
import type { UsageAggregate } from '../usage/usage.js';
import { estimateTokens } from '../usage/usage.js';

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

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
  options: { total?: number; halt?: HaltReason | null } = {}
): SubagentLoopLike & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async *run(prompt: string) {
      prompts.push(prompt);
      for (const chunk of chunks) yield chunk;
    },
    getUsage: () => usage(options.total ?? 500),
    getHaltReason: () => options.halt ?? null,
  };
}

function ctx(policy?: PermissionPolicy): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: '/tmp',
    permissions: new Permissions(policy),
    abortSignal: new AbortController().signal,
  };
}

describe('compressResult', () => {
  it('keeps short results untouched', () => {
    expect(compressResult('  short answer  ', 100)).toBe('short answer');
  });

  it('compresses long results within the token budget keeping head and tail', () => {
    const text = `START ${'a'.repeat(4000)} END`;
    const compressed = compressResult(text, 100);
    expect(estimateTokens(compressed)).toBeLessThanOrEqual(100);
    expect(compressed.startsWith('START')).toBe(true);
    expect(compressed.endsWith('END')).toBe(true);
    expect(compressed).toContain('…');
  });
});

describe('subagents', () => {
  it('runs the agent loop and returns a compressed result', async () => {
    const loop = fakeLoop(['Findings: the ', 'parser lives in src/parse.ts']);
    const subagents = new Subagents({ createLoop: () => loop });
    const result = await subagents.run({
      prompt: 'Where is the parser?',
      provider: 'p',
      model: 'm',
    });
    expect(result.agent).toBe('general');
    expect(result.text).toBe('Findings: the parser lives in src/parse.ts');
    expect(result.tokens).toBe(500);
    expect(result.haltReason).toBeNull();
    expect(loop.prompts[0]).toContain('research subagent');
    expect(loop.prompts[0]).toContain('Where is the parser?');
  });

  it('rejects non-subagent agents and depth beyond the limit', async () => {
    const subagents = new Subagents({ createLoop: () => fakeLoop(['x']) });
    await expect(
      subagents.run({ prompt: 'x', agent: 'build', provider: 'p', model: 'm' })
    ).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
    await expect(
      subagents.run({ prompt: 'x', depth: 1, provider: 'p', model: 'm' })
    ).rejects.toMatchObject({
      code: 'TOOL_EXECUTION_FAILED',
      message: expect.stringContaining('depth'),
    });
  });

  it('enforces the concurrency limit', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: SubagentLoopLike = {
      async *run() {
        yield 'partial ';
        await gate;
        yield 'done';
      },
      getUsage: () => usage(10),
      getHaltReason: () => null,
    };
    const subagents = new Subagents({ maxConcurrent: 1, createLoop: () => slow });
    const first = subagents.run({ prompt: 'a', provider: 'p', model: 'm' });
    expect(subagents.activeCount).toBe(1);
    await expect(subagents.run({ prompt: 'b', provider: 'p', model: 'm' })).rejects.toMatchObject({
      code: 'TOOL_EXECUTION_FAILED',
      message: expect.stringContaining('concurrency'),
    });
    release();
    await expect(first).resolves.toMatchObject({ text: 'partial done' });
    expect(subagents.activeCount).toBe(0);
  });

  it('rejects when cancelled upfront', async () => {
    const subagents = new Subagents({ createLoop: () => fakeLoop(['x']) });
    const controller = new AbortController();
    controller.abort();
    await expect(
      subagents.run({ prompt: 'x', provider: 'p', model: 'm', signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('propagates mid-run cancellation', async () => {
    const controller = new AbortController();
    const subagents = new Subagents({
      createLoop: () => ({
        async *run() {
          controller.abort();
          yield 'partial';
          throw new LumpsError('CANCELLED', 'agent loop cancelled');
        },
        getUsage: () => usage(1),
        getHaltReason: () => null,
      }),
    });
    await expect(
      subagents.run({ prompt: 'x', provider: 'p', model: 'm', signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('task tool', () => {
  function tools(): Tools {
    const subagents = new Subagents({ createLoop: () => fakeLoop(['compressed result']) });
    const registry = new Tools({ logger: quiet() });
    registry.register(taskTool(subagents, { provider: 'p', model: 'm' }));
    return registry;
  }

  it('denies by default and runs with the subagent group allowed', async () => {
    const denied = await tools().execute(
      { id: 'c1', name: 'task', arguments: { prompt: 'research x' } },
      ctx()
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('PERMISSION_DENIED');

    const allowed = await tools().execute(
      { id: 'c2', name: 'task', arguments: { prompt: 'research x' } },
      ctx({ mode: 'ask', allowedGroups: ['read', 'subagent'] })
    );
    expect(allowed.success).toBe(true);
    expect(allowed.output).toMatchObject({
      agent: 'general',
      text: 'compressed result',
      tokens: 500,
    });
  });

  it('requires a prompt', async () => {
    const result = await tools().execute(
      { id: 'c3', name: 'task', arguments: {} },
      ctx({ mode: 'ask', allowedGroups: ['subagent'] })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('task requires a prompt');
  });
});
