import { describe, expect, it } from 'vitest';
import { defaultConfig, type Config, type MCPServerConfig, type MCPTool } from '@larecode/core';
import {
  mcpAdd,
  mcpCall,
  mcpList,
  mcpRemove,
  parsePairs,
  type McpConnectionLike,
  type McpDeps,
} from './commands/mcp.js';

function configOf(mcpServers: Record<string, MCPServerConfig> = {}): Config {
  return { ...defaultConfig(), mcpServers };
}

function harness(config: Config, options: { policy?: Partial<Config['permissions']> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const connected: MCPServerConfig[] = [];
  const disconnected: string[] = [];
  const calls: Array<{ server: string; tool: string; args: unknown }> = [];
  if (options.policy)
    config = { ...config, permissions: { ...config.permissions, ...options.policy } };
  let saved: Config | null = null;
  const connection: McpConnectionLike = {
    listTools: async (): Promise<MCPTool[]> => [],
    callTool: async (server, tool, args) => {
      calls.push({ server, tool, args });
      return 'tool output';
    },
    disconnect: async (name) => {
      disconnected.push(name);
    },
  };
  const deps: McpDeps = {
    globalConfig: () => config,
    effectiveConfig: () => config,
    saveConfig: (next) => {
      saved = next;
    },
    connect: async (server) => {
      connected.push(server);
      return connection;
    },
    write: (text) => out.push(text),
    writeError: (text) => err.push(text),
  };
  return {
    deps,
    out,
    err,
    connected,
    disconnected,
    calls,
    get saved() {
      return saved;
    },
  };
}

describe('parsePairs', () => {
  it('parses KEY=VALUE entries', () => {
    expect(parsePairs(['A=1', 'B=x=y'])).toEqual({ A: '1', B: 'x=y' });
    expect(parsePairs(undefined)).toEqual({});
    expect(parsePairs(['missing-equals'])).toBeNull();
  });
});

describe('mcp add/remove/list', () => {
  it('adds a stdio server with args and env', async () => {
    const ui = harness(configOf());
    const code = await mcpAdd(
      'fake',
      { command: 'node', arg: ['server.js'], env: ['TOKEN=abc'] },
      ui.deps
    );
    expect(code).toBe(0);
    expect(ui.saved?.mcpServers.fake).toEqual({
      name: 'fake',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'abc' },
    });
    expect(ui.out.join('')).toContain('added mcp server "fake"');
  });

  it('adds an http server with headers', async () => {
    const ui = harness(configOf());
    const code = await mcpAdd(
      'remote',
      { url: 'https://example.com/mcp', header: ['Authorization=Bearer x'] },
      ui.deps
    );
    expect(code).toBe(0);
    expect(ui.saved?.mcpServers.remote).toEqual({
      name: 'remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    });
  });

  it('rejects invalid combinations', async () => {
    const ui = harness(configOf());
    expect(await mcpAdd(undefined, {}, ui.deps)).toBe(1);
    expect(await mcpAdd('bad', {}, ui.deps)).toBe(1);
    expect(await mcpAdd('bad', { command: 'node', url: 'http://x' }, ui.deps)).toBe(1);
    expect(await mcpAdd('bad', { command: 'node', env: ['nope'] }, ui.deps)).toBe(1);
    expect(ui.err.join('')).toContain('--env and --header entries must use KEY=VALUE');
  });

  it('adds a preset server under the preset name', async () => {
    const ui = harness(configOf());
    const code = await mcpAdd(undefined, { preset: 'playwright' }, ui.deps);
    expect(code).toBe(0);
    expect(ui.saved?.mcpServers.playwright).toEqual({
      name: 'playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    });
    expect(ui.out.join('')).toContain('added mcp server "playwright" (playwright preset)');
  });

  it('adds a preset server under a custom name and rejects unknown presets', async () => {
    const ui = harness(configOf());
    expect(await mcpAdd('pw', { preset: 'playwright' }, ui.deps)).toBe(0);
    expect(ui.saved?.mcpServers.pw?.command).toBe('npx');
    expect(await mcpAdd('x', { preset: 'ghost' }, ui.deps)).toBe(1);
    expect(ui.err.join('')).toContain('unknown preset: ghost');
    expect(await mcpAdd('x', { preset: 'playwright', command: 'node' }, ui.deps)).toBe(1);
    expect(ui.err.join('')).toContain('use either --preset or --command/--url, not both');
  });

  it('removes a configured server and rejects unknown names', async () => {
    const ui = harness(configOf({ fake: { name: 'fake', transport: 'stdio', command: 'node' } }));
    expect(await mcpRemove('ghost', ui.deps)).toBe(1);
    expect(await mcpRemove('fake', ui.deps)).toBe(0);
    expect(ui.saved?.mcpServers).toEqual({});
  });

  it('lists configured servers', async () => {
    const empty = harness(configOf());
    expect(await mcpList(empty.deps)).toBe(0);
    expect(empty.out.join('')).toContain('no mcp servers configured');

    const ui = harness(
      configOf({
        fake: { name: 'fake', transport: 'stdio', command: 'node', args: ['server.js'] },
        remote: { name: 'remote', transport: 'http', url: 'https://example.com/mcp' },
      })
    );
    expect(await mcpList(ui.deps)).toBe(0);
    const text = ui.out.join('');
    expect(text).toContain('fake');
    expect(text).toContain('node server.js');
    expect(text).toContain('https://example.com/mcp');
  });
});

describe('mcp call', () => {
  it('rejects unknown servers', async () => {
    const ui = harness(configOf());
    expect(await mcpCall('ghost', 'echo', {}, ui.deps)).toBe(1);
    expect(ui.err.join('')).toContain('unknown mcp server: ghost');
  });

  it('denies calls that need confirmation without --yes', async () => {
    const ui = harness(configOf({ fake: { name: 'fake', transport: 'stdio', command: 'node' } }));
    expect(await mcpCall('fake', 'echo', {}, ui.deps)).toBe(1);
    expect(ui.connected).toEqual([]);
    expect(ui.err.join('')).toContain('permission denied');
    expect(ui.err.join('')).toContain('--yes');
  });

  it('runs the call after --yes confirmation', async () => {
    const ui = harness(configOf({ fake: { name: 'fake', transport: 'stdio', command: 'node' } }));
    expect(await mcpCall('fake', 'echo', { args: '{"text":"hi"}', yes: true }, ui.deps)).toBe(0);
    expect(ui.calls).toEqual([{ server: 'fake', tool: 'echo', args: { text: 'hi' } }]);
    expect(ui.out.join('')).toContain('tool output');
    expect(ui.disconnected).toEqual(['fake']);
  });

  it('runs without --yes when external-services is allowed', async () => {
    const ui = harness(configOf({ fake: { name: 'fake', transport: 'stdio', command: 'node' } }), {
      policy: { allowedGroups: ['read', 'external-services'] },
    });
    expect(await mcpCall('fake', 'echo', {}, ui.deps)).toBe(0);
    expect(ui.connected).toHaveLength(1);
  });

  it('rejects invalid --args JSON', async () => {
    const ui = harness(configOf({ fake: { name: 'fake', transport: 'stdio', command: 'node' } }), {
      policy: { allowedGroups: ['read', 'external-services'] },
    });
    expect(await mcpCall('fake', 'echo', { args: '{nope' }, ui.deps)).toBe(1);
    expect(ui.err.join('')).toContain('--args must be valid JSON');
  });
});
