import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { VERSION } from '../version.js';
import type { PermissionPolicy } from '../permission/permission.js';
import type { MCPServerConfig } from '../mcp/mcp.js';
import type { ExecutionConfig } from '../exec/backend.js';

export interface ProviderConfig {
  type: 'openai-compatible' | 'anthropic' | 'ollama' | 'openrouter' | 'zai' | 'custom';
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface Config {
  version: string;
  defaultProvider: string;
  defaultModel: string;
  permissions: PermissionPolicy;
  providers: Record<string, ProviderConfig>;
  mcpServers: Record<string, MCPServerConfig>;
  execution?: ExecutionConfig;
}

export function larecodeHome(): string {
  return process.env.LARECODE_HOME ?? join(homedir(), '.larecode');
}

export function configPath(): string {
  return join(larecodeHome(), 'config.json');
}

export function projectConfigPath(projectDir: string = process.cwd()): string {
  return join(projectDir, 'larecode.json');
}

export function defaultConfig(): Config {
  return {
    version: VERSION,
    defaultProvider: 'openai-compatible',
    defaultModel: 'gpt-4o',
    permissions: { mode: 'ask', allowedGroups: ['read'] },
    providers: {
      'openai-compatible': {
        type: 'openai-compatible',
        baseUrl: 'http://localhost:20128/v1',
        models: ['gpt-4o', 'gpt-4o-mini'],
      },
      ollama: {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        models: ['llama3', 'qwen2.5-coder'],
      },
    },
    mcpServers: {},
    execution: { backend: 'local' },
  };
}

export function loadConfig(path: string = configPath()): Config {
  if (!existsSync(path)) return defaultConfig();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  return { ...defaultConfig(), ...raw };
}

export function loadEffectiveConfig(
  projectDir: string = process.cwd(),
  path: string = configPath()
): Config {
  const config = loadConfig(path);
  const projectFile = projectConfigPath(projectDir);
  if (!existsSync(projectFile)) return config;
  const project = JSON.parse(readFileSync(projectFile, 'utf8')) as Partial<Config>;
  return {
    ...config,
    ...project,
    permissions: { ...config.permissions, ...project.permissions },
    providers: { ...config.providers, ...project.providers },
    mcpServers: { ...config.mcpServers, ...project.mcpServers },
  };
}

export function validateConfig(config: Config): string[] {
  const problems: string[] = [];
  const provider = config.providers[config.defaultProvider];
  if (!provider) {
    problems.push(`default provider "${config.defaultProvider}" is not configured`);
  } else if (!provider.models.includes(config.defaultModel)) {
    problems.push(
      `default model "${config.defaultModel}" is not offered by provider "${config.defaultProvider}"`
    );
  }
  if (!['ask', 'allow', 'deny'].includes(config.permissions.mode)) {
    problems.push(`permission mode "${config.permissions.mode}" is not one of ask, allow, deny`);
  }
  for (const [name, entry] of Object.entries(config.providers)) {
    if (!entry.baseUrl) problems.push(`provider "${name}" has no baseUrl`);
  }
  const execution = config.execution;
  if (execution) {
    if (!['local', 'docker', 'ssh'].includes(execution.backend)) {
      problems.push(`execution backend "${execution.backend}" is not one of local, docker, ssh`);
    } else if (execution.backend === 'docker' && !execution.docker?.image) {
      problems.push('execution backend "docker" requires execution.docker.image');
    } else if (execution.backend === 'ssh' && !execution.ssh?.host) {
      problems.push('execution backend "ssh" requires execution.ssh.host');
    }
  }
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    const transport = server.transport ?? (server.url ? 'http' : 'stdio');
    if (!['stdio', 'http'].includes(transport)) {
      problems.push(`mcp server "${name}" transport "${transport}" is not stdio or http`);
    } else if (transport === 'http' && !server.url) {
      problems.push(`mcp server "${name}" uses http transport but has no url`);
    } else if (transport === 'stdio' && !server.command) {
      problems.push(`mcp server "${name}" uses stdio transport but has no command`);
    }
  }
  return problems;
}

export function saveConfig(config: Config, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}
