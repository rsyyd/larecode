import { Hooks, HOOK_TYPES } from '@larecode/core';
import { larecodeHome } from '@larecode/core';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOK_TYPE_LABELS: Record<string, string> = {
  'pre-tool': 'Pre-tool (runs before tool execution)',
  'post-tool': 'Post-tool (runs after tool execution)',
  'session-start': 'Session start',
  'session-end': 'Session end',
};

interface HookCommandOptions {
  json?: boolean;
}

function getHooksDir(): string {
  return join(larecodeHome(), 'hooks');
}

function loadHookConfigs() {
  const hooksDir = getHooksDir();
  if (!require('node:fs').existsSync(hooksDir)) return [];

  const configs = [];
  for (const file of require('node:fs').readdirSync(hooksDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = require('node:fs').readFileSync(
        require('node:path').join(hooksDir, file),
        'utf8'
      );
      const config = JSON.parse(content);
      configs.push({ ...config, file });
    } catch {
      // skip invalid
    }
  }
  return configs;
}

export function hookListCommand(options: HookCommandOptions = {}): number {
  const hooks = loadHookConfigs();

  if (hooks.length === 0) {
    console.log('No hooks configured');
    return 0;
  }

  if (options.json) {
    console.log(JSON.stringify(hooks, null, 2));
    return 0;
  }

  console.log('Configured hooks:');
  for (const hook of hooks) {
    const enabled = hook.enabled !== false ? '✓' : '○';
    const types = hook.types?.join(', ') ?? 'all';
    console.log(`  ${enabled} ${hook.name} (${hook.types?.join(', ') ?? 'all events'})`);
    if (hook.description) console.log(`    ${hook.description}`);
  }
  return 0;
}

export function hookEnableCommand(name: string): number {
  const hooksDir = join(require('@larecode/core').larecodeHome(), 'hooks');
  const file = require('node:path').join(hooksDir, `${name}.json`);

  if (!require('node:fs').existsSync(file)) {
    console.error(`Hook ${name} not found`);
    return 1;
  }

  const config = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  config.enabled = true;
  require('node:fs').writeFileSync(file, JSON.stringify(config, null, 2));
  console.log(`Enabled hook: ${name}`);
  return 0;
}

export function hookDisableCommand(name: string): number {
  const hooksDir = join(require('@larecode/core').larecodeHome(), 'hooks');
  const file = require('node:path').join(hooksDir, `${name}.json`);

  if (!require('node:fs').existsSync(file)) {
    console.error(`Hook ${name} not found`);
    return 1;
  }

  const config = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  config.enabled = false;
  require('node:fs').writeFileSync(file, JSON.stringify(config, null, 2));
  console.log(`Disabled hook: ${name}`);
  return 0;
}

export function hookInitCommand(options: { name: string; type?: string }): number {
  if (!options.name) {
    console.error('Hook name required');
    return 1;
  }

  const type = options.type ?? 'pre-tool';
  if (!['pre-tool', 'post-tool', 'session-start', 'session-end'].includes(type)) {
    console.error('Invalid hook type');
    return 1;
  }

  const hooksDir = getHooksDir();
  require('node:fs').mkdirSync(hooksDir, { recursive: true });

  const config = {
    name: options.name,
    type,
    enabled: true,
    description: '',
  };

  require('node:fs').writeFileSync(
    require('node:path').join(hooksDir, `${options.name}.json`),
    JSON.stringify(config, null, 2)
  );

  console.log(`Created hook ${options.name} (type: ${options.type ?? 'pre-tool'}) in ${hooksDir}`);
  return 0;
}

export function hookCommand(program: any) {
  const hook = program.command('hook').description('Manage lifecycle hooks');

  hook
    .command('list')
    .description('List configured hooks')
    .option('--json', 'output as JSON')
    .action(async (options: { json?: boolean }) => {
      process.exitCode = hookListCommand(options);
    });

  hook
    .command('enable <name>')
    .description('Enable a hook')
    .action(async (name: string) => {
      process.exitCode = hookEnableCommand(name);
    });

  hook
    .command('disable <name>')
    .description('Disable a hook')
    .action(async (name: string) => {
      process.exitCode = hookDisableCommand(name);
    });

  hook
    .command('init <name>')
    .description('Create a new hook configuration')
    .option(
      '--type <type>',
      'hook type: pre-tool, post-tool, session-start, session-end',
      'pre-tool'
    )
    .action(async (name: string, options: { type?: string }) => {
      process.exitCode = hookInitCommand({ name, type: options.type });
    });
}

export default hookCommand;
