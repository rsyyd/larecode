import { describe, expect, it } from 'vitest';
import { Tools, type Tool, type ToolContext } from './tool.js';
import { Logger, type LogEntry } from '../logger/logger.js';
import { Permissions } from '../permission/permission.js';
import { LareError } from '../error/error.js';

function capturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger = new Logger({
    level: 'debug',
    handlers: [(e) => entries.push(e)],
  });
  return { logger, entries };
}

function dummyContext(signal?: AbortSignal): ToolContext {
  return {
    sessionId: 's1',
    workingDir: '/tmp',
    permissions: new Permissions({ mode: 'allow', allowedGroups: ['read'] }),
    abortSignal: signal ?? new AbortController().signal,
  };
}

function echoTool(): Tool {
  return {
    name: 'echo',
    description: 'echoes its input',
    schema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'text to echo' } },
      required: ['message'],
    },
    async execute(args: unknown) {
      const p = args as { message: string };
      return `echo: ${p.message}`;
    },
  };
}

describe('Tools', () => {
  it('registers, lists, and looks up tools', () => {
    const { logger } = capturingLogger();
    const tools = new Tools({ logger });
    tools.register(echoTool());

    expect(tools.has('echo')).toBe(true);
    expect(tools.has('missing')).toBe(false);
    expect(tools.list()).toHaveLength(1);
    expect(tools.get('echo')?.name).toBe('echo');
  });

  it('logs registration as debug', () => {
    const { logger, entries } = capturingLogger();
    new Tools({ logger }).register(echoTool());
    const reg = entries.find((e) => e.message === 'tool registered');
    expect(reg).toBeDefined();
    expect(reg?.level).toBe('debug');
    expect((reg?.context as { name: string } | undefined)?.name).toBe('echo');
  });

  it('calls a registered tool and returns its output', async () => {
    const { logger, entries } = capturingLogger();
    const tools = new Tools({ logger });
    tools.register(echoTool());

    const result = await tools.execute(
      { id: 'c1', name: 'echo', arguments: { message: 'hi' } },
      dummyContext()
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('echo: hi');
    expect(result.id).toBe('c1');
    expect(entries.some((e) => e.message === 'calling tool')).toBe(true);
    expect(entries.some((e) => e.message === 'tool complete')).toBe(true);
  });

  it('invokes the tool through the execute pipeline with context', async () => {
    const capturedArgs: unknown[] = [];
    const tool: Tool = {
      name: 'ctx',
      description: 'returns session id',
      schema: { type: 'object', properties: {}, required: [] },
      async execute(args: unknown, ctx: ToolContext): Promise<string> {
        capturedArgs.push(args);
        return ctx.sessionId;
      },
    };

    const tools = new Tools({ logger: capturingLogger().logger });
    tools.register(tool);
    const result = await tools.execute(
      { id: 'c2', name: 'ctx', arguments: { x: 1 } },
      dummyContext()
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('s1');
    expect(capturedArgs).toEqual([{ x: 1 }]);
  });

  it('returns a failed result for a missing tool', async () => {
    const { logger, entries } = capturingLogger();
    const tools = new Tools({ logger });
    const result = await tools.execute({ id: 'c3', name: 'nope', arguments: {} }, dummyContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool not found: nope');
    expect(
      entries.some((e) => e.message === 'tool call failed: not found' && e.level === 'warn')
    ).toBe(true);
  });

  it('maps tool failures to TOOL_EXECUTION_FAILED error code in the result', async () => {
    const failingTool: Tool = {
      name: 'throws',
      description: 'always fails',
      schema: { type: 'object', properties: {}, required: [] },
      async execute() {
        throw new LareError('TOOL_EXECUTION_FAILED', 'boom', { context: { step: 1 } });
      },
    };
    const { logger, entries } = capturingLogger();
    const tools = new Tools({ logger });
    tools.register(failingTool);

    const result = await tools.execute({ id: 'fx', name: 'throws', arguments: {} }, dummyContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('TOOL_EXECUTION_FAILED: boom');
    expect(entries.some((e) => e.message === 'tool failed')).toBe(true);
  });

  it('maps plain Error failures with their message', async () => {
    const failingTool: Tool = {
      name: 'plain',
      description: '',
      schema: { type: 'object', properties: {}, required: [] },
      async execute() {
        throw new Error('plain boom');
      },
    };
    const tools = new Tools({ logger: capturingLogger().logger });
    tools.register(failingTool);
    const result = await tools.execute({ id: 'p', name: 'plain', arguments: {} }, dummyContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('plain boom');
  });

  it('aborts when the context signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool: Tool = {
      name: 'ghost',
      description: '',
      schema: { type: 'object', properties: {}, required: [] },
      async execute() {
        throw new Error('should not reach');
      },
    };
    const tools = new Tools({ logger: capturingLogger().logger });
    tools.register(tool);
    const result = await tools.execute(
      { id: 'ab', name: 'ghost', arguments: {} },
      dummyContext(controller.signal)
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('cancelled');
  });

  it('warns on a duplicate registration', () => {
    const { logger, entries } = capturingLogger();
    const tools = new Tools({ logger });
    tools.register(echoTool());
    tools.register(echoTool());
    expect(entries.some((e) => e.message === 'tool already registered, overwriting')).toBe(true);
  });

  it('exposes JSON-schema tool specs for the provider', () => {
    const { logger } = capturingLogger();
    const tools = new Tools({ logger });
    tools.register(echoTool());

    const specs = tools.toToolSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe('echo');
    expect(specs[0].parameters.type).toBe('object');
    expect(specs[0].parameters.properties).toBeDefined();
  });
});
