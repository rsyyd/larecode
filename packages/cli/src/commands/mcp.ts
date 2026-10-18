import {
  Logger,
  MCP,
  MCP_PRESETS,
  MCP_PRESET_NAMES,
  Permissions,
  configPath,
  loadConfig,
  loadEffectiveConfig,
  saveConfig as saveConfigFile,
  type Config,
  type MCPServerConfig,
  type MCPTool,
} from '@lumpscode/core';

export interface McpConnectionLike {
  listTools(server: string): Promise<MCPTool[]>;
  callTool(server: string, tool: string, args: unknown): Promise<string>;
  disconnect(name: string): Promise<void>;
}

export interface McpDeps {
  globalConfig?: () => Config;
  effectiveConfig?: () => Config;
  saveConfig?: (config: Config) => void;
  permissions?: (config: Config) => Permissions;
  connect?: (server: MCPServerConfig) => Promise<McpConnectionLike>;
  write?: (text: string) => void;
  writeError?: (text: string) => void;
}

export interface McpAddOptions {
  command?: string;
  arg?: string[];
  env?: string[];
  url?: string;
  header?: string[];
  preset?: string;
}

export interface McpCallOptions {
  args?: string;
  yes?: boolean;
}

export function parsePairs(entries: string[] | undefined): Record<string, string> | null {
  const pairs: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const index = entry.indexOf('=');
    if (index <= 0) return null;
    pairs[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return pairs;
}

function resolveDeps(deps: McpDeps) {
  return {
    globalConfig: deps.globalConfig ?? (() => loadConfig()),
    effectiveConfig: deps.effectiveConfig ?? (() => loadEffectiveConfig()),
    saveConfig: deps.saveConfig ?? ((config: Config) => saveConfigFile(config, configPath())),
    permissions: deps.permissions ?? ((config: Config) => new Permissions(config.permissions)),
    connect:
      deps.connect ??
      (async (server: MCPServerConfig) => {
        const mcp = new MCP({ logger: new Logger({ level: 'error', handlers: [] }) });
        await mcp.connect(server);
        return mcp;
      }),
    write: deps.write ?? ((text: string) => process.stdout.write(text)),
    writeError: deps.writeError ?? ((text: string) => process.stderr.write(text)),
  };
}

function transportTarget(server: MCPServerConfig): string {
  const transport = server.transport ?? (server.url ? 'http' : 'stdio');
  if (transport === 'http') return server.url ?? '';
  return [server.command, ...(server.args ?? [])].join(' ');
}

export async function mcpList(deps: McpDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);
  const config = resolved.effectiveConfig();
  const names = Object.keys(config.mcpServers ?? {});
  if (names.length === 0) {
    resolved.write('no mcp servers configured\n');
    return 0;
  }
  for (const name of names) {
    const server = config.mcpServers[name];
    const transport = server.transport ?? (server.url ? 'http' : 'stdio');
    resolved.write(`${name.padEnd(20)} ${transport.padEnd(6)} ${transportTarget(server)}\n`);
  }
  return 0;
}

export async function mcpAdd(
  name: string | undefined,
  options: McpAddOptions,
  deps: McpDeps = {}
): Promise<number> {
  const resolved = resolveDeps(deps);
  if (options.preset) {
    if (options.url || options.command) {
      resolved.writeError('use either --preset or --command/--url, not both\n');
      return 1;
    }
    const preset = MCP_PRESETS[options.preset];
    if (!preset) {
      resolved.writeError(
        `unknown preset: ${options.preset} (available: ${MCP_PRESET_NAMES.join(', ')})\n`
      );
      return 1;
    }
    const serverName = name ?? options.preset;
    const config = resolved.globalConfig();
    config.mcpServers = { ...config.mcpServers, [serverName]: { name: serverName, ...preset } };
    resolved.saveConfig(config);
    resolved.write(`added mcp server "${serverName}" (${options.preset} preset)\n`);
    return 0;
  }
  if (!name) {
    resolved.writeError('provide a server name or --preset <name>\n');
    return 1;
  }
  if (options.url && options.command) {
    resolved.writeError('use either --url (http) or --command (stdio), not both\n');
    return 1;
  }
  if (!options.url && !options.command) {
    resolved.writeError('provide --command <executable> (stdio) or --url <url> (http)\n');
    return 1;
  }
  const env = parsePairs(options.env);
  const headers = parsePairs(options.header);
  if (!env || !headers) {
    resolved.writeError('--env and --header entries must use KEY=VALUE\n');
    return 1;
  }
  const server: MCPServerConfig = options.url
    ? {
        name,
        transport: 'http',
        url: options.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }
    : {
        name,
        transport: 'stdio',
        command: options.command,
        ...(options.arg && options.arg.length > 0 ? { args: options.arg } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
  const config = resolved.globalConfig();
  config.mcpServers = { ...config.mcpServers, [name]: server };
  resolved.saveConfig(config);
  resolved.write(`added mcp server "${name}"\n`);
  return 0;
}

export async function mcpRemove(name: string, deps: McpDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);
  const config = resolved.globalConfig();
  if (!config.mcpServers?.[name]) {
    resolved.writeError(`unknown mcp server: ${name}\n`);
    return 1;
  }
  const remaining = { ...config.mcpServers };
  delete remaining[name];
  config.mcpServers = remaining;
  resolved.saveConfig(config);
  resolved.write(`removed mcp server "${name}"\n`);
  return 0;
}

export async function mcpCall(
  server: string,
  tool: string,
  options: McpCallOptions = {},
  deps: McpDeps = {}
): Promise<number> {
  const resolved = resolveDeps(deps);
  const config = resolved.effectiveConfig();
  const entry = config.mcpServers?.[server];
  if (!entry) {
    resolved.writeError(`unknown mcp server: ${server}\n`);
    return 1;
  }

  const decision = resolved
    .permissions(config)
    .check('external-services', { source: `mcp:${server}/${tool}` });
  const confirmed =
    decision.allowed || (decision.requiresConfirmation === true && options.yes === true);
  if (!confirmed) {
    resolved.writeError(`permission denied: ${decision.reason ?? 'not allowed'}\n`);
    if (decision.requiresConfirmation) {
      resolved.writeError('re-run with --yes to confirm this call\n');
    }
    return 1;
  }

  let args: unknown = {};
  if (options.args) {
    try {
      args = JSON.parse(options.args);
    } catch {
      resolved.writeError('--args must be valid JSON\n');
      return 1;
    }
  }

  const connection = await resolved.connect(entry);
  try {
    const output = await connection.callTool(server, tool, args);
    resolved.write(output.endsWith('\n') ? output : `${output}\n`);
  } catch (error) {
    resolved.writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    await connection.disconnect(server);
  }
  return 0;
}
