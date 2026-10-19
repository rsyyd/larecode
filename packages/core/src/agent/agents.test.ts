import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_AGENTS, toolsForAgent } from './agents.js';
import { coreTools } from '../tool/core.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Permissions, type PermissionPolicy } from '../permission/permission.js';
import { Logger } from '../logger/logger.js';

let dir: string;

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

function ctx(policy?: PermissionPolicy): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: dir,
    permissions: new Permissions(policy),
    abortSignal: new AbortController().signal,
  };
}

function registryFor(agent: 'build' | 'plan' | 'general'): Tools {
  const tools = new Tools({ logger: quiet() });
  for (const tool of toolsForAgent(coreTools(), BUILTIN_AGENTS[agent])) tools.register(tool);
  return tools;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lare-agents-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('agent tool sets', () => {
  it('build has full access', () => {
    const names = toolsForAgent(coreTools(), BUILTIN_AGENTS.build).map((tool) => tool.name);
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('patch');
    expect(names).toContain('bash');
  });

  it('plan cannot write: mutating tools are absent', () => {
    const names = toolsForAgent(coreTools(), BUILTIN_AGENTS.plan).map((tool) => tool.name);
    expect(names).not.toContain('write');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('patch');
    expect(names).toContain('read');
    expect(names).toContain('bash');
  });

  it('general is read-only: no write, bash, or task tools', () => {
    const names = toolsForAgent(coreTools(), BUILTIN_AGENTS.general).map((tool) => tool.name);
    expect(names).not.toContain('write');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('patch');
    expect(names).not.toContain('bash');
    expect(names).not.toContain('task');
  });

  it('plan mode cannot reach write tools through execution', async () => {
    const tools = registryFor('plan');
    expect(tools.has('write')).toBe(false);
    const result = await tools.execute(
      { id: 'c1', name: 'write', arguments: { path: 'x.txt', content: 'nope' } },
      ctx({ mode: 'allow', allowedGroups: [] })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool not found');
  });

  it('plan mode asks before bash while build runs it', async () => {
    const plan = registryFor('plan');
    const denied = await plan.execute(
      { id: 'c1', name: 'bash', arguments: { command: 'echo plan-denied' } },
      ctx()
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('PERMISSION_DENIED');

    const allowed = await plan.execute(
      { id: 'c2', name: 'bash', arguments: { command: 'echo plan-ok' } },
      ctx({ mode: 'ask', allowedGroups: ['read', 'shell'] })
    );
    expect(allowed.success).toBe(true);

    const build = registryFor('build');
    const buildResult = await build.execute(
      { id: 'c3', name: 'bash', arguments: { command: 'echo build-ok' } },
      ctx({ mode: 'ask', allowedGroups: ['read', 'shell'] })
    );
    expect(buildResult.success).toBe(true);
  });
});
