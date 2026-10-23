import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { VERSION } from '../version.js';
import { LOCALES, type Locale } from '../i18n.js';
import type { PermissionPolicy } from '../permission/permission.js';
import type { MCPServerConfig } from '../mcp/mcp.js';
import type { ExecutionConfig } from '../exec/backend.js';

export interface ProviderConfig {
  type: 'openai-compatible' | 'anthropic' | 'ollama' | 'openrouter' | 'zai' | 'custom';
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export const CONFIG_SCHEMA_VERSION = 2;

export interface ContextConfig {
  enabled?: boolean;
  repoMap?: boolean;
  retrieval?: boolean;
  memory?: boolean;
  budgetTokens?: number;
}

export interface WebSearchConfig {
  provider?: 'duckduckgo' | 'custom';
  endpoint?: string;
  apiKey?: string;
}

export interface FallbackTarget {
  provider: string;
  model?: string;
}

export interface Config {
  version: string;
  schemaVersion?: number;
  defaultProvider: string;
  defaultModel: string;
  permissions: PermissionPolicy;
  providers: Record<string, ProviderConfig>;
  mcpServers: Record<string, MCPServerConfig>;
  execution?: ExecutionConfig;
  context?: ContextConfig;
  webSearch?: WebSearchConfig;
  locale?: Locale;
  fallbacks?: FallbackTarget[];
  checkpoints?: boolean;
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
    schemaVersion: CONFIG_SCHEMA_VERSION,
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
    context: { enabled: true, repoMap: true, retrieval: true, memory: true, budgetTokens: 8000 },
    webSearch: { provider: 'duckduckgo' },
    fallbacks: [],
  };
}

export function loadConfig(path: string = configPath()): Config {
  if (!existsSync(path)) return defaultConfig();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  const defaults = defaultConfig();
  return {
    ...defaults,
    ...raw,
    version: VERSION,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    permissions: { ...defaults.permissions, ...raw.permissions },
    providers: raw.providers ?? defaults.providers,
    mcpServers: raw.mcpServers ?? defaults.mcpServers,
    execution: raw.execution ?? defaults.execution,
    context: { ...defaults.context, ...raw.context },
    webSearch: { ...defaults.webSearch, ...raw.webSearch },
    fallbacks: raw.fallbacks ?? defaults.fallbacks,
  };
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
    schemaVersion: CONFIG_SCHEMA_VERSION,
    permissions: { ...config.permissions, ...project.permissions },
    providers: { ...config.providers, ...project.providers },
    mcpServers: { ...config.mcpServers, ...project.mcpServers },
    context: { ...config.context, ...project.context },
    webSearch: { ...config.webSearch, ...project.webSearch },
    fallbacks: project.fallbacks ?? config.fallbacks,
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
  if (config.locale !== undefined && !LOCALES.includes(config.locale)) {
    problems.push(`locale "${config.locale}" is not one of en, id`);
  }
  for (const [name, entry] of Object.entries(config.providers)) {
    if (!entry.baseUrl) problems.push(`provider "${name}" has no baseUrl`);
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      problems.push(`provider "${name}" has no models`);
    }
  }
  for (const target of config.fallbacks ?? []) {
    const provider = config.providers[target.provider];
    if (!provider) {
      problems.push(`fallback provider "${target.provider}" is not configured`);
    } else if (target.model && !provider.models.includes(target.model)) {
      problems.push(
        `fallback model "${target.model}" is not offered by provider "${target.provider}"`
      );
    }
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
