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

async function printProvider(
  name: string,
  provider: ProviderConfig,
  model: string,
  timeoutMs: number
): Promise<string[]> {
  const checks = await providerChecks(name, provider, model, { timeoutMs });
  console.log(`  ${name}`);
  for (const check of checks) {
    const mark = check.ok ? ok('✓') : bad('✗');
    const detail = check.ok ? dim(check.detail) : bad(check.detail);
    console.log(`    ${mark} ${check.label.padEnd(12)} ${detail}`);
  }
  return checks
    .filter((check) => !check.ok)
    .map((check) => `provider "${name}": ${check.label} — ${check.detail}`);
}

function printInstructions(): void {
  const files = discoverInstructions(process.cwd());
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

export async function runDoctor(): Promise<void> {
  const config: Config = loadEffectiveConfig();
  const problems = validateConfig(config);
  const home = homeRow();
  if (home.problem) problems.push(home.problem);

  console.log(`larecode ${VERSION} doctor\n`);

  const path = configPath();
  const pathState = existsSync(path) ? '' : dim(' (missing — defaults active)');
  console.log('Config');
  console.log(`  path            ${path}${pathState}`);
  console.log(home.line);
  if (existsSync(projectConfigPath())) console.log(`  project         ${projectConfigPath()}`);
  console.log(`  provider        ${config.defaultProvider}`);
  console.log(`  model           ${config.defaultModel}`);
  console.log(`  providers       ${Object.keys(config.providers).length} configured`);
  console.log(`  mcp servers     ${Object.keys(config.mcpServers ?? {}).length} configured`);
  console.log(`  execution       ${config.execution?.backend ?? 'local'}`);

  console.log('\nProviders');
  const providerProblems = (
    await Promise.all(
      Object.entries(config.providers).map(([name, provider]) =>
        printProvider(
          name,
          provider,
          name === config.defaultProvider ? config.defaultModel : (provider.models[0] ?? ''),
          4000
        )
      )
    )
  ).flat();
  problems.push(...providerProblems);

  console.log('\nPermissions');
  console.log(`  mode            ${config.permissions.mode}`);
  console.log(`  groups          ${config.permissions.allowedGroups.join(', ') || dim('none')}`);

  printInstructions();

  if (problems.length > 0) {
    console.log(`\n${bad(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)}`);
    for (const problem of problems) console.log(`  ${bad('×')} ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${ok('✓')} configuration valid`);
  }
}
