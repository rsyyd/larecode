import { accessSync, constants, existsSync } from 'node:fs';
import {
  VERSION,
  configPath,
  loadEffectiveConfig,
  larecodeHome,
  validateConfig,
  discoverInstructions,
  projectConfigPath,
  AnthropicAdapter,
  LareError,
  OllamaAdapter,
  openAIAdapterFromConfig,
  type Config,
  type LareCodeFetch,
  type ProviderAdapter,
  type ProviderConfig,
} from '@larecode/core';

const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;
const warn = (text: string) => `\x1b[33m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

const LOCAL_HOST =
  /^https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|host\.docker\.internal|[^/]+\.local)(?::\d+)?(?:\/|$)/;

export interface ProviderCheck {
  label: 'auth' | 'reachability' | 'model' | 'streaming';
  ok: boolean;
  detail: string;
}

export interface ProviderCheckOptions {
  fetchImpl?: LareCodeFetch;
  timeoutMs?: number;
}

function messageOf(error: unknown): string {
  if (error instanceof LareError) {
    const status = error.context.status;
    return status
      ? `${error.message} (HTTP ${String(status)})`
      : `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function reachable(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: LareCodeFetch
): Promise<boolean> {
  try {
    const url = new URL(baseUrl);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

function adapterFor(
  name: string,
  provider: ProviderConfig,
  fetchImpl: LareCodeFetch
): ProviderAdapter {
  if (provider.type === 'anthropic') {
    return new AnthropicAdapter({
      name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      models: provider.models,
      fetchImpl,
    });
  }
  if (provider.type === 'ollama') {
    return new OllamaAdapter({
      name,
      baseUrl: provider.baseUrl,
      models: provider.models,
      fetchImpl,
    });
  }
  return openAIAdapterFromConfig(name, provider, fetchImpl);
}

export async function providerChecks(
  name: string,
  provider: ProviderConfig,
  model: string,
  options: ProviderCheckOptions = {}
): Promise<ProviderCheck[]> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const needsKey = provider.type !== 'ollama' && !LOCAL_HOST.test(provider.baseUrl);
  if (needsKey && !provider.apiKey) {
    return [{ label: 'auth', ok: false, detail: 'no API key configured' }];
  }

  const auth: ProviderCheck = {
    label: 'auth',
    ok: true,
    detail: needsKey ? 'key configured' : 'not required',
  };
  if (!(await reachable(provider.baseUrl, timeoutMs, fetchImpl))) {
    return [auth, { label: 'reachability', ok: false, detail: provider.baseUrl }];
  }

  const checks: ProviderCheck[] = [
    auth,
    { label: 'reachability', ok: true, detail: provider.baseUrl },
  ];
  const adapter = adapterFor(name, provider, fetchImpl);

  try {
    const models = await adapter.models();
    const listed = models.some((entry) => entry.id === model);
    checks.push({
      label: 'model',
      ok: listed,
      detail: listed ? model : `${model} is not in the provider catalog`,
    });
  } catch (error) {
    checks.push({ label: 'model', ok: false, detail: messageOf(error) });
  }

  try {
    for await (const _chunk of adapter.streamComplete('Reply with OK.', {
      model,
      maxTokens: 1,
      timeoutMs,
      abortSignal: AbortSignal.timeout(timeoutMs),
    })) {
      // drain
    }
    checks.push({ label: 'streaming', ok: true, detail: 'ok' });
  } catch (error) {
    checks.push({ label: 'streaming', ok: false, detail: messageOf(error) });
  }

  return checks;
}

export interface DoctorOptions {
  json?: boolean;
}

export interface ProviderHealth {
  provider: string;
  model: string;
  checks: ProviderCheck[];
}

async function checkProvider(
  name: string,
  provider: ProviderConfig,
  model: string,
  timeoutMs: number
): Promise<ProviderHealth> {
  return {
    provider: name,
    model,
    checks: await providerChecks(name, provider, model, { timeoutMs }),
  };
}

function providerProblemLines(health: ProviderHealth): string[] {
  return health.checks
    .filter((check) => !check.ok)
    .map(
      (check) =>
        `provider "${health.provider}" model "${health.model}": ${check.label} — ${check.detail}`
    );
}

function printProviderHealth(health: ProviderHealth): string[] {
  console.log(`  ${health.provider}${health.model ? ` / ${health.model}` : ''}`);
  for (const check of health.checks) {
    const mark = check.ok ? ok('✓') : bad('✗');
    const detail = check.ok ? dim(check.detail) : bad(check.detail);
    console.log(`    ${mark} ${check.label.padEnd(12)} ${detail}`);
  }
  return providerProblemLines(health);
}

function printInstructions(files = discoverInstructions(process.cwd())): void {
  console.log('\nInstructions');
  if (files.length === 0) {
    console.log(`  ${dim('none found in ' + process.cwd())}`);
    return;
  }
  for (const file of files) {
    if (file.status === 'consented') {
      console.log(`    ${ok('✓')} ${file.relative.padEnd(32)} ${dim('consented')}`);
    } else if (file.status === 'changed') {
      console.log(
        `    ${warn('~')} ${file.relative.padEnd(32)} ${warn('changed — re-approval required')}`
      );
    } else {
      console.log(
        `    ${warn('?')} ${file.relative.padEnd(32)} ${dim('pending — ignored until approved')}`
      );
    }
  }
}

export function suggestionFor(problem: string): string {
  if (problem.includes('no API key')) {
    return 'run "larecode setup --provider <name>" or add apiKey to the provider config';
  }
  if (problem.includes('not in the provider catalog')) {
    return 'check the model id or add it to the provider models list';
  }
  if (problem.includes('not writable')) {
    return 'fix permissions or set LARECODE_HOME to a writable directory';
  }
  if (problem.includes('auth')) {
    return 'verify apiKey and baseUrl for this provider';
  }
  if (problem.includes('reachability')) {
    return 'check that the provider is running and baseUrl is reachable';
  }
  if (problem.includes('streaming')) {
    return 'confirm the provider supports streaming and the selected model exists';
  }
  if (problem.includes('default model') || problem.includes('defaultModel')) {
    return 'set defaultModel or run "larecode setup --model <id>"';
  }
  return 'run "larecode doctor" after fixing the config or environment';
}

function homeRow(): { line: string; problem?: string } {
  const home = larecodeHome();
  if (!existsSync(home)) {
    return { line: `  home            ${home} ${dim('(missing — created on first write)')}` };
  }
  try {
    accessSync(home, constants.W_OK);
    return { line: `  home            ${home} ${dim('writable')}` };
  } catch {
    return {
      line: `  home            ${home} ${bad('not writable')}`,
      problem: `home directory ${home} is not writable`,
    };
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const config: Config = loadEffectiveConfig();
  const problems = validateConfig(config);
  const home = homeRow();
  if (home.problem) problems.push(home.problem);

  const instructions = discoverInstructions(process.cwd());
  const path = configPath();
  const project = existsSync(projectConfigPath()) ? projectConfigPath() : undefined;

  const healthMatrix = await Promise.all(
    Object.entries(config.providers).map(([name, provider]) => {
      const primary = name === config.defaultProvider ? config.defaultModel : '';
      const models = provider.models.length > 0 ? provider.models : primary ? [primary] : [];
      return Promise.all(models.map((model) => checkProvider(name, provider, model, 4000)));
    })
  );
  const health = healthMatrix.flat();
  const providerProblems = health.flatMap((entry) => providerProblemLines(entry));
  problems.push(...providerProblems);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          version: VERSION,
          config: {
            path,
            project,
            home: larecodeHome(),
            provider: config.defaultProvider,
            model: config.defaultModel,
            providers: Object.keys(config.providers).length,
            mcpServers: Object.keys(config.mcpServers ?? {}).length,
            execution: config.execution?.backend ?? 'local',
            mode: config.permissions.mode,
          },
          providers: health,
          instructions: instructions.map((file) => ({
            file: file.relative,
            status: file.status,
          })),
          problems,
          suggestions: problems.map(suggestionFor),
          ok: problems.length === 0,
        },
        null,
        2
      ) + '\n'
    );
    process.exitCode = problems.length === 0 ? 0 : 1;
    return;
  }

  console.log(`larecode ${VERSION} doctor\n`);

  console.log('Config');
  console.log(
    `  path            ${path}${existsSync(path) ? '' : dim(' (missing — defaults active)')}`
  );
  console.log(home.line);
  if (project) console.log(`  project         ${project}`);
  console.log(`  provider        ${config.defaultProvider}`);
  console.log(`  model           ${config.defaultModel}`);
  console.log(`  providers       ${Object.keys(config.providers).length} configured`);
  console.log(`  mcp servers     ${Object.keys(config.mcpServers ?? {}).length} configured`);
  console.log(`  execution       ${config.execution?.backend ?? 'local'}`);

  console.log('\nProviders');
  for (const entry of health) printProviderHealth(entry);

  console.log('\nPermissions');
  console.log(`  mode            ${config.permissions.mode}`);
  console.log(`  groups          ${config.permissions.allowedGroups.join(', ') || dim('none')}`);

  printInstructions(instructions);

  if (problems.length > 0) {
    console.log(`\n${bad(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)}`);
    for (const problem of problems) console.log(`  ${bad('×')} ${problem}`);
    console.log('\nSuggestions');
    for (const suggestion of problems.map(suggestionFor)) console.log(`  ${ok('→')} ${suggestion}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${ok('✓')} configuration valid`);
  }
}
