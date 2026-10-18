import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Plugins, discoverPlugins } from './plugin.js';
import { Hooks } from '../hook/hook.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Permissions } from '../permission/permission.js';
import { Logger } from '../logger/logger.js';

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

let root: string;
let home: string;
let project: string;
let previousHome: string | undefined;
let plugins: Plugins | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumps-plugin-'));
  home = join(root, 'home');
  project = join(root, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  previousHome = process.env.LUMPSCODE_HOME;
  process.env.LUMPSCODE_HOME = home;
});

afterEach(async () => {
  await plugins?.close();
  plugins = undefined;
  if (previousHome === undefined) delete process.env.LUMPSCODE_HOME;
  else process.env.LUMPSCODE_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

function writePlugin(
  rootDir: string,
  name: string,
  options: { manifest?: Record<string, unknown>; code?: string; entry?: string } = {}
): string {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    name,
    version: '1.0.0',
    entry: options.entry ?? 'index.mjs',
    ...options.manifest,
  };
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
  if (options.code !== undefined) writeFileSync(join(dir, manifest.entry), options.code);
  return dir;
}

function userPluginsDir(): string {
  return join(home, 'plugins');
}

function projectPluginsDir(): string {
  return join(project, '.lumpscode', 'plugins');
}

function ctx(): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: '/tmp',
    permissions: new Permissions(),
    abortSignal: new AbortController().signal,
  };
}

function registryWith(hooks: Hooks): { tools: Tools; executed: string[] } {
  const executed: string[] = [];
  const tools = new Tools({ logger: quiet(), hooks });
  tools.register({
    name: 'echo',
    description: 'echo',
    schema: { type: 'object', properties: {}, required: [] },
    async execute() {
      executed.push('echo');
      return 'ok';
    },
  });
  return { tools, executed };
}

describe('plugin discovery', () => {
  it('classifies user plugins as trusted and project plugins as untrusted', () => {
    writePlugin(userPluginsDir(), 'user-plugin', { code: 'export const activate = () => {};' });
    writePlugin(projectPluginsDir(), 'project-plugin', { code: 'export const handle = () => {};' });
    const found = discoverPlugins(project);
    const byName = Object.fromEntries(found.map((info) => [info.name, info]));
    expect(byName['user-plugin'].trust).toBe('trusted');
    expect(byName['user-plugin'].origin).toBe('user');
    expect(byName['project-plugin'].trust).toBe('untrusted');
    expect(byName['project-plugin'].origin).toBe('project');
    expect(byName['user-plugin'].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('skips invalid manifests, escaping entries, and missing files', () => {
    writePlugin(userPluginsDir(), 'no-version', {
      manifest: { version: undefined },
      code: 'export const activate = () => {};',
    });
    writePlugin(userPluginsDir(), 'escape', { manifest: { entry: '../../evil.mjs' } });
    writePlugin(userPluginsDir(), 'missing-entry', { manifest: { entry: 'nope.mjs' } });
    writePlugin(userPluginsDir(), 'valid', { code: 'export const activate = () => {};' });
    expect(discoverPlugins(project).map((info) => info.name)).toEqual(['valid']);
  });

  it('lets user plugins win over same-named project plugins', () => {
    writePlugin(userPluginsDir(), 'demo', { code: 'export const activate = () => {};' });
    writePlugin(projectPluginsDir(), 'demo', { code: 'export const handle = () => {};' });
    const found = discoverPlugins(project);
    expect(found).toHaveLength(1);
    expect(found[0].trust).toBe('trusted');
  });
});

describe('trusted plugins', () => {
  it('registers hooks in-process and blocks tool calls', async () => {
    writePlugin(userPluginsDir(), 'guard', {
      code: `
export const activate = (api) => {
  api.registerHook('pre-tool', (context) => {
    if (context.call && context.call.name === 'echo') {
      return { block: true, reason: 'guard plugin says no' };
    }
  });
};
`,
    });
    const hooks = new Hooks({ logger: quiet() });
    plugins = new Plugins({ projectDir: project, logger: quiet() });
    const report = await plugins.load(hooks);
    expect(report.loaded).toEqual(['guard']);
    expect(report.failed).toEqual([]);

    const { tools, executed } = registryWith(hooks);
    const result = await tools.execute({ id: 'c1', name: 'echo', arguments: {} }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('PERMISSION_DENIED: guard plugin says no');
    expect(executed).toEqual([]);
  });

  it('reports plugins without an activate export as failed', async () => {
    writePlugin(userPluginsDir(), 'incomplete', { code: 'export const nothing = true;' });
    const hooks = new Hooks({ logger: quiet() });
    plugins = new Plugins({ projectDir: project, logger: quiet() });
    const report = await plugins.load(hooks);
    expect(report.loaded).toEqual([]);
    expect(report.failed[0]).toMatchObject({ name: 'incomplete' });
    expect(report.failed[0].reason).toContain('activate');
  });
});

describe('untrusted plugins over IPC', () => {
  it('runs project plugins out of process and honors their hook decisions', async () => {
    writePlugin(projectPluginsDir(), 'ipc-guard', {
      code: `
export const handle = (method, params) => {
  if (method === 'pre-tool' && params.call && params.call.name === 'echo') {
    return { block: true, reason: 'ipc plugin says no' };
  }
  return null;
};
`,
    });
    const hooks = new Hooks({ logger: quiet() });
    plugins = new Plugins({ projectDir: project, logger: quiet() });
    const report = await plugins.load(hooks);
    expect(report.loaded).toEqual(['ipc-guard']);

    const { tools, executed } = registryWith(hooks);
    const result = await tools.execute({ id: 'c2', name: 'echo', arguments: {} }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('PERMISSION_DENIED: ipc plugin says no');
    expect(executed).toEqual([]);

    const allowed = await tools.execute({ id: 'c3', name: 'other', arguments: {} }, ctx());
    expect(allowed.success).toBe(false);
    expect(allowed.error).toContain('Tool not found');
  });

  it('fails closed when an untrusted plugin call times out', async () => {
    writePlugin(projectPluginsDir(), 'hangs', {
      code: 'export const handle = () => new Promise(() => {});',
    });
    const hooks = new Hooks({ logger: quiet() });
    plugins = new Plugins({ projectDir: project, logger: quiet(), timeoutMs: 500 });
    const report = await plugins.load(hooks);
    expect(report.loaded).toEqual(['hangs']);

    const decision = await hooks.emit('pre-tool', {
      call: { id: 'c4', name: 'echo', arguments: {} },
    });
    expect(decision?.block).toBe(true);
    expect(decision?.reason).toContain('timed out');
  });

  it('reports plugins without a handle export as failed', async () => {
    writePlugin(projectPluginsDir(), 'no-handle', { code: 'export const activate = () => {};' });
    const hooks = new Hooks({ logger: quiet() });
    plugins = new Plugins({ projectDir: project, logger: quiet() });
    const report = await plugins.load(hooks);
    expect(report.loaded).toEqual([]);
    expect(report.failed[0]).toMatchObject({ name: 'no-handle' });
    expect(report.failed[0].reason).toContain('handle');
  });
});
