import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { PermissionPolicy } from '../permissions/engine.js';

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
}

export function defaultConfig(): Config {
  return {
    version: '0.0.0',
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
  };
}

export class ConfigManager {
  private path: string;

  constructor(path: string = join(homedir(), '.lumpscode', 'config.json')) {
    this.path = path;
  }

  load(): Config {
    if (!existsSync(this.path)) return defaultConfig();
    const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Config;
    return { ...defaultConfig(), ...raw };
  }

  save(config: Config): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }

  get configPath(): string {
    return this.path;
  }
}
