import { existsSync } from 'node:fs';
import {
  configPath,
  loadConfig,
  saveConfig,
  validateConfig,
  type Config,
  type ProviderConfig,
} from '@lumpscode/core';

const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

export interface SetupOptions {
  provider?: string;
  type?: ProviderConfig['type'];
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  force?: boolean;
}

export interface SetupDeps {
  path?: string;
  write?: (text: string) => void;
  exists?: (path: string) => boolean;
}

export function buildConfig(
  base: Config,
  options: SetupOptions
): { config: Config; provider: string; model: string } {
  const name = options.provider ?? base.defaultProvider;
  const existing = base.providers[name];
  const type = options.type ?? existing?.type ?? 'openai-compatible';
  const models =
    options.model !== undefined
      ? [options.model, ...(existing?.models ?? []).filter((m) => m !== options.model)]
      : (existing?.models ?? [base.defaultModel]);

  const provider: ProviderConfig = {
    type,
    baseUrl: options.baseUrl ?? existing?.baseUrl ?? 'http://localhost:20128/v1',
    models,
    ...(options.apiKey !== undefined
      ? { apiKey: options.apiKey }
      : existing?.apiKey !== undefined
        ? { apiKey: existing.apiKey }
        : {}),
  };

  const model = options.model ?? provider.models[0] ?? base.defaultModel;
  return {
    config: {
      ...base,
      defaultProvider: name,
      defaultModel: model,
      providers: { ...base.providers, [name]: provider },
    },
    provider: name,
    model,
  };
}

export async function setupCommand(options: SetupOptions, deps: SetupDeps = {}): Promise<void> {
  const path = deps.path ?? configPath();
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const exists = deps.exists ?? existsSync;

  if (exists(path) && !options.force) {
    write(`${bad('setup:')} ${path} already exists (use --force to overwrite)\n`);
    process.exitCode = 1;
    return;
  }

  const { config, provider, model } = buildConfig(loadConfig(path), options);
  saveConfig(config, path);

  const problems = validateConfig(config);
  write(`${ok('✓')} wrote ${path}\n`);
  write(`  provider        ${provider} (${config.providers[provider].type})\n`);
  write(`  base url        ${config.providers[provider].baseUrl}\n`);
  write(`  model           ${model}\n`);
  if (problems.length > 0) {
    for (const problem of problems) write(`  ${bad('×')} ${problem}\n`);
  }
  write(`\n${dim('next: lumpscode doctor && lumpscode run "explain this repository"')}\n`);
}
