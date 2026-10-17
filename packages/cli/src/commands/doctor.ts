import { existsSync } from 'node:fs';
import {
  VERSION,
  configPath,
  loadEffectiveConfig,
  validateConfig,
  discoverInstructions,
  projectConfigPath,
  type Config,
  type ProviderConfig,
} from '@lumpscode/core';

const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;
const warn = (text: string) => `\x1b[33m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

async function reachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

function printProviderRow(name: string, provider: ProviderConfig): Promise<void> {
  return reachable(provider.baseUrl).then((isReachable) => {
    const mark = isReachable ? ok('✓') : bad('✗');
    const state = isReachable ? dim('reachable') : bad('unreachable');
    console.log(`    ${mark} ${name.padEnd(20)} ${provider.baseUrl.padEnd(34)} ${state}`);
  });
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

export async function runDoctor(): Promise<void> {
  const config: Config = loadEffectiveConfig();
  const problems = validateConfig(config);

  console.log(`lumpscode ${VERSION} doctor\n`);

  const path = configPath();
  const pathState = existsSync(path) ? '' : dim(' (missing — defaults active)');
  console.log('Config');
  console.log(`  path            ${path}${pathState}`);
  if (existsSync(projectConfigPath())) console.log(`  project         ${projectConfigPath()}`);
  console.log(`  provider        ${config.defaultProvider}`);
  console.log(`  model           ${config.defaultModel}`);
  console.log(`  providers       ${Object.keys(config.providers).length} configured`);

  console.log('\n  reachability');
  await Promise.all(
    Object.entries(config.providers).map(([name, provider]) => printProviderRow(name, provider))
  );

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
