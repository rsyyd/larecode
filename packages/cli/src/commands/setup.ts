import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  configPath,
  loadConfig,
  saveConfig,
  validateConfig,
  type Config,
  type ProviderConfig,
} from '@larecode/core';

const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

export function firstRunHint(
  options: {
    path?: string;
    exists?: (path: string) => boolean;
    write?: (text: string) => void;
  } = {}
): boolean {
  const path = options.path ?? configPath();
  const exists = options.exists ?? existsSync;
  const write = options.write ?? ((text: string) => process.stderr.write(text));
  if (exists(path)) return false;
  write(
    `larecode: no config at ${path}; using built-in defaults. Run \`larecode setup\` to choose a provider.\n`
  );
  return true;
}

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
  ask?: (question: string, fallback?: string) => Promise<string>;
}

const SETUP_PRESETS = [
  {
    type: 'openai-compatible',
    label: 'OpenAI-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    type: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-sonnet-latest',
  },
  {
    type: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5-coder:14b',
  },
  {
    type: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    type: 'zai',
    label: 'Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.5',
  },
  {
    type: 'custom',
    label: 'Custom OpenAI-compatible',
    baseUrl: 'http://localhost:8000/v1',
    model: 'my-model',
  },
] as const;

async function runPrompts(
  ask: (question: string, fallback?: string) => Promise<string>
): Promise<SetupOptions> {
  const askValue = async (label: string, fallback = ''): Promise<string> => {
    const answer = (await ask(label, fallback)).trim();
    return answer || fallback;
  };
  const options = SETUP_PRESETS.map((preset, index) => `[${index + 1}] ${preset.label}`).join(', ');
  const choice = (await askValue(`Provider ${options}`, '1')).toLowerCase();
  const preset =
    SETUP_PRESETS.find(
      (candidate, index) => String(index + 1) === choice || candidate.type === choice
    ) ?? SETUP_PRESETS[0];
  const baseUrl = await askValue('Base URL', preset.baseUrl);
  const model = await askValue('Model', preset.model);
  const apiKey =
    preset.type === 'ollama' ? '' : await askValue('API key (leave empty to set later)');
  return {
    provider: preset.type,
    type: preset.type,
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
  };
}

async function interactiveSetup(deps: SetupDeps): Promise<SetupOptions> {
  if (deps.ask) return runPrompts(deps.ask);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await runPrompts((question, fallback = '') => {
      const suffix = fallback ? ` [${fallback}]` : '';
      return rl.question(`${question}${suffix}: `).then((answer) => answer.trim() || fallback);
    });
  } finally {
    rl.close();
  }
}

function validBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid base URL "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`base URL must use http or https: "${value}"`);
  }
  return value.replace(/\/+$/, '');
}

export function buildConfig(
  base: Config,
  options: SetupOptions
): { config: Config; provider: string; model: string } {
  const name = options.provider ?? base.defaultProvider;
  const existing = base.providers[name];
  const type = options.type ?? existing?.type ?? 'openai-compatible';
  const requestedModel = options.model?.trim();
  if (options.model !== undefined && !requestedModel) throw new Error('model cannot be empty');
  const models = requestedModel
    ? [requestedModel, ...(existing?.models ?? []).filter((m) => m !== requestedModel)]
    : (existing?.models ?? [base.defaultModel]);

  const provider: ProviderConfig = {
    type,
    baseUrl: validBaseUrl(options.baseUrl ?? existing?.baseUrl ?? 'http://localhost:20128/v1'),
    models,
    ...(options.apiKey !== undefined
      ? { apiKey: options.apiKey }
      : existing?.apiKey !== undefined
        ? { apiKey: existing.apiKey }
        : {}),
  };

  const model = requestedModel ?? provider.models[0] ?? base.defaultModel;
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

  const hasChoices =
    options.provider !== undefined ||
    options.type !== undefined ||
    options.baseUrl !== undefined ||
    options.apiKey !== undefined ||
    options.model !== undefined;
  const canPrompt =
    deps.ask !== undefined ||
    (!process.env.VITEST && process.stdin.isTTY === true && process.stdout.isTTY === true);
  const effective = !hasChoices && canPrompt ? await interactiveSetup(deps) : options;

  const loaded = loadConfig(path);
  const base = exists(path) ? loaded : { ...loaded, providers: {} };

  let built: ReturnType<typeof buildConfig>;
  try {
    built = buildConfig(base, effective);
  } catch (error) {
    write(`${bad('setup:')} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const { config, provider, model } = built;
  const problems = validateConfig(config);
  if (problems.length > 0) {
    write(`${bad('setup:')} invalid configuration\n`);
    for (const problem of problems) write(`  ${bad('×')} ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  saveConfig(config, path);

  write(`${ok('✓')} wrote ${path}\n`);
  write(`  provider        ${provider} (${config.providers[provider].type})\n`);
  write(`  base url        ${config.providers[provider].baseUrl}\n`);
  write(`  model           ${model}\n`);
  write(`\n${dim('next: larecode doctor && larecode run "explain this repository"')}\n`);
}
