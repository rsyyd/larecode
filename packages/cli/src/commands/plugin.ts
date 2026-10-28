import { Plugins, discoverPlugins, pluginRoots, type PluginInfo, type PluginTrust } from '@larecode/core';
import { larecodeHome } from '@larecode/core';
import { mkdirSync, readdirSync, rmSync, existsSync, cpSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

interface PluginCommandOptions {
  projectDir?: string;
}

function getPluginsDir(): string {
  return join(larecodeHome(), 'plugins');
}

function getProjectPluginsDir(projectDir: string): string {
  return join(projectDir, '.larecode', 'plugins');
}

function loadManifest(pluginDir: string) {
  const pkgPath = join(pluginDir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.larecode?.plugin) return null;
  return pkg;
}

export function pluginListCommand(_options: { json?: boolean } = {}): number {
  const globalDir = getPluginsDir();
  const projectDir = getProjectPluginsDir(process.cwd());
  
  const allPlugins: Array<{ info: ReturnType<typeof loadManifest>; dir: string; origin: 'user' | 'project' }> = [];
  
  for (const dir of [globalDir, projectDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const pluginDir = join(dir, name);
      const manifest = loadManifest(pluginDir);
      if (manifest) {
        allPlugins.push({ info: manifest, dir: pluginDir, origin: dir === globalDir ? 'user' : 'project' });
      }
    }
  }
  
  if (allPlugins.length === 0) {
    console.log('No plugins installed');
    return 0;
  }
  
  console.log('Installed plugins:');
  for (const { info, origin } of allPlugins) {
    const trustMark = info.trust === 'trusted' ? '✓' : '○';
    console.log(`  ${trustMark} ${info.name}@${info.version} (${info.trust}) [${origin}]`);
    if (info.description) console.log(`    ${info.description}`);
  }
  
  return 0;
}

export function pluginInstallCommand(
  source: string,
  options: { trust?: 'trusted' | 'untrusted'; name?: string } = {}
): number {
  const sourcePath = resolve(source);
  
  if (!existsSync(sourcePath)) {
    console.error(`Source not found: ${sourcePath}`);
    return 1;
  }
  
  const pkgPath = join(sourcePath, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error('Plugin must have a package.json');
    return 1;
  }
  
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const pluginName = options.name ?? manifest.name;
  
  if (!manifest.larecode?.plugin) {
    console.error('package.json must have a "larecode.plugin" field');
    return 1;
  }
  
  const targetDir = join(larecodeHome(), 'plugins', manifest.name);
  
  if (existsSync(targetDir)) {
    console.error(`Plugin ${manifest.name} already installed`);
    return 1;
  }
  
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourcePath, targetDir, { recursive: true });
  
  // Update manifest with trust level
  const updatedManifest = { ...manifest, trust: options.trust ?? 'untrusted' };
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify(updatedManifest, null, 2));
  
  console.log(`Installed ${manifest.name}@${manifest.version} to ${targetDir}`);
  console.log(`Trust level: ${options.trust ?? 'untrusted'}`);
  console.log('Run "larecode plugin list" to verify');
  
  return 0;
}

export function pluginRemoveCommand(name: string): number {
  const globalDir = join(larecodeHome(), 'plugins', name);
  const projectDir = join(process.cwd(), '.larecode', 'plugins', name);
  
  let removed = false;
  if (existsSync(globalDir)) {
    rmSync(globalDir, { recursive: true, force: true });
    removed = true;
  }
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
    removed = true;
  }
  
  if (!removed) {
    console.error(`Plugin ${name} not found`);
    return 1;
  }
  
  console.log(`Removed plugin ${name}`);
  return 0;
}

export function pluginTrustCommand(name: string, trust: 'trusted' | 'untrusted'): number {
  const globalDir = join(larecodeHome(), 'plugins', name);
  const projectDir = join(process.cwd(), '.larecode', 'plugins', name);
  
  let found = false;
  for (const dir of [globalDir, projectDir]) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
      manifest.trust = trust;
      writeFileSync(pkgPath, JSON.stringify(manifest, null, 2));
      found = true;
      console.log(`Set trust level for ${name} to ${trust}`);
    }
  }
  
  if (!found) {
    console.error(`Plugin ${name} not found`);
    return 1;
  }
  
  return 0;
}

export function pluginInitCommand(options: { name: string; dir?: string } = { name: '' }): number {
  if (!options.name) {
    console.error('Plugin name required');
    return 1;
  }
  
  const targetDir = options.dir ? resolve(options.dir, options.name) : join(tmpdir(), `larecode-plugin-${options.name}`);
  
  mkdirSync(targetDir, { recursive: true });
  
  const manifest = {
    name: options.name,
    version: '0.1.0',
    description: '',
    main: 'index.js',
    scripts: {
      test: 'echo "Error: no test specified" && exit 1'
    },
    larecode: {
      plugin: {
        entry: 'index.js',
        hooks: ['pre-tool', 'post-tool']
      }
    },
    trust: 'untrusted',
    keywords: ['larecode-plugin'],
    license: 'MIT'
  };
  
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(targetDir, 'index.js'), `export function handle(method, params) {
  switch (method) {
    case 'activate':
      return { ready: true };
    default:
      throw new Error('Unknown method: ' + method);
  }
}`);
  
  console.log(`Created plugin scaffold at ${targetDir}`);
  return 0;
}

function pluginCommand(program: any) {
  const plugin = program
    .command('plugin')
    .description('Manage plugins');

  plugin
    .command('list')
    .description('List installed plugins')
    .option('--json', 'output as JSON')
    .action(async (options: { json?: boolean }) => {
      process.exitCode = pluginListCommand(options);
    });

  plugin
    .command('install <source>')
    .description('Install a plugin from a local directory')
    .option('--trust <level>', 'trust level: trusted or untrusted', 'untrusted')
    .option('--name <name>', 'override plugin name')
    .action(async (source: string, options: { trust?: string; name?: string }) => {
      process.exitCode = pluginInstallCommand(source, { trust: options.trust as any, name: options.name });
    });

  plugin
    .command('remove <name>')
    .description('Remove an installed plugin')
    .action(async (name: string) => {
      process.exitCode = pluginRemoveCommand(name);
    });

  plugin
    .command('trust <name> <level>')
    .description('Set trust level for a plugin (trusted|untrusted)')
    .action(async (name: string, trust: string) => {
      process.exitCode = pluginTrustCommand(name, trust as any);
    });

  plugin
    .command('init <name>')
    .description('Create a new plugin scaffold')
    .option('--dir <path>', 'directory to create plugin in')
    .action(async (name: string, options: { dir?: string }) => {
      process.exitCode = pluginInitCommand({ name, dir: options.dir });
    });
}

export { pluginCommand };