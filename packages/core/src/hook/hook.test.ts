import { describe, expect, it } from 'vitest';
import { Hooks } from './hook.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Permissions } from '../permission/permission.js';
import { Logger } from '../logger/logger.js';

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

function ctx(): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: '/tmp',
    permissions: new Permissions(),
    abortSignal: new AbortController().signal,
  };
}

describe('hooks', () => {
  it('returns the first block decision and skips later hooks', async () => {
    const hooks = new Hooks({ logger: quiet() });
    const calls: string[] = [];
    hooks.register({
      type: 'pre-tool',
      name: 'deny',
      handler: () => {
        calls.push('deny');
        return { block: true, reason: 'not today' };
      },
    });
    hooks.register({
      type: 'pre-tool',
      name: 'later',
      handler: () => {
        calls.push('later');
      },
    });
    const decision = await hooks.emit('pre-tool', {
      call: { id: 'c1', name: 'bash', arguments: {} },
    });
    expect(decision).toEqual({ block: true, reason: 'not today' });
    expect(calls).toEqual(['deny']);
  });

  it('fails closed when a pre-tool hook throws but tolerates post-tool failures', async () => {
    const hooks = new Hooks({ logger: quiet() });
    hooks.register({
      type: 'pre-tool',
      handler: () => {
        throw new Error('boom');
      },
    });
    const blocked = await hooks.emit('pre-tool', {});
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain('hook error: boom');

    hooks.register({
      type: 'post-tool',
      handler: () => {
        throw new Error('ignored');
      },
    });
    await expect(hooks.emit('post-tool', {})).resolves.toBeNull();
  });
});

describe('tool pipeline hooks', () => {
  function registry(hooks: Hooks): { tools: Tools; executed: string[] } {
    const executed: string[] = [];
    const tools = new Tools({ logger: quiet(), hooks });
    tools.register({
      name: 'echo',
      description: 'echo',
      schema: { type: 'object', properties: {}, required: [] },
      async execute(args) {
        executed.push('echo');
        return args;
      },
    });
    return { tools, executed };
  }

  it('blocks a tool call from a pre-tool hook without executing it', async () => {
    const hooks = new Hooks({ logger: quiet() });
    hooks.register({
      type: 'pre-tool',
      name: 'guard',
      handler: () => ({ block: true, reason: 'nope' }),
    });
    const { tools, executed } = registry(hooks);
    const result = await tools.execute({ id: 'c1', name: 'echo', arguments: { x: 1 } }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('PERMISSION_DENIED: nope');
    expect(executed).toEqual([]);
  });

  it('runs the call and reports the result to post-tool hooks', async () => {
    const hooks = new Hooks({ logger: quiet() });
    const seen: unknown[] = [];
    hooks.register({ type: 'post-tool', handler: (context) => void seen.push(context.result) });
    const { tools, executed } = registry(hooks);
    const result = await tools.execute({ id: 'c2', name: 'echo', arguments: { x: 1 } }, ctx());
    expect(result).toMatchObject({ success: true, output: { x: 1 } });
    expect(executed).toEqual(['echo']);
    expect(seen).toEqual([{ id: 'c2', success: true, output: { x: 1 } }]);
  });
});
