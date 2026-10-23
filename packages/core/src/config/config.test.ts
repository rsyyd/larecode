import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultConfig,
  loadConfig,
  loadEffectiveConfig,
  saveConfig,
  validateConfig,
  type Config,
} from './config.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'larecode-config-'));
  process.env.LARECODE_HOME = home;
});

afterEach(() => {
  delete process.env.LARECODE_HOME;
});

describe('config', () => {
  it('defaults to openai-compatible with ollama available', () => {
    const config = defaultConfig();
    expect(config.defaultProvider).toBe('openai-compatible');
    expect(Object.keys(config.providers)).toContain('ollama');
  });

  it('upgrades a 0.1 config with missing sections', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        version: '0.1.0',
        defaultProvider: 'legacy',
        defaultModel: 'legacy-model',
        providers: {
          legacy: {
            type: 'openai-compatible',
            baseUrl: 'https://legacy.example/v1',
            models: ['legacy-model'],
          },
        },
        permissions: { mode: 'ask' },
      })
    );

    const config = loadConfig();

    expect(config.version).toBe(defaultConfig().version);
    expect(config.permissions).toEqual({ mode: 'ask', allowedGroups: ['read'] });
    expect(config.mcpServers).toEqual({});
    expect(config.execution).toEqual({ backend: 'local' });
    expect(config.providers.legacy?.models).toEqual(['legacy-model']);
  });

  it('round-trips through save and load with 0600 permissions', () => {
    const config = defaultConfig();
    config.defaultModel = 'gpt-4o-mini';
    saveConfig(config);
    const loaded = loadConfig();
    expect(loaded.defaultModel).toBe('gpt-4o-mini');
    const mode = statSync(join(home, 'config.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('falls back to defaults when no config exists', () => {
    expect(loadConfig().defaultProvider).toBe('openai-compatible');
  });

  it('lets a project larecode.json override the global config', () => {
    const project = mkdtempSync(join(tmpdir(), 'larecode-project-'));
    writeFileSync(
      join(project, 'larecode.json'),
      JSON.stringify({ defaultProvider: 'ollama', defaultModel: 'llama3' })
    );
    const effective = loadEffectiveConfig(project);
    expect(effective.defaultProvider).toBe('ollama');
    expect(effective.defaultModel).toBe('llama3');
    expect(effective.providers['openai-compatible']).toBeDefined();
  });

  it('flags an unknown default provider', () => {
    const config = defaultConfig();
    config.defaultProvider = 'missing';
    expect(validateConfig(config)).toHaveLength(1);
  });

  it('flags a default model the provider does not offer', () => {
    const config = defaultConfig();
    config.defaultModel = 'not-a-model';
    expect(validateConfig(config)).toHaveLength(1);
  });

  it('passes validation for a healthy config', () => {
    expect(validateConfig(defaultConfig())).toEqual([]);
  });

  it('accepts only en and id locales', () => {
    const config = defaultConfig();
    config.locale = 'id';
    expect(validateConfig(config)).toEqual([]);
    config.locale = 'fr' as Config['locale'];
    expect(validateConfig(config)).toEqual([`locale "fr" is not one of en, id`]);
  });

  it('flags incomplete execution backends', () => {
    const docker = defaultConfig();
    docker.execution = { backend: 'docker' };
    expect(validateConfig(docker)).toEqual([
      'execution backend "docker" requires execution.docker.image',
    ]);

    const ssh = defaultConfig();
    ssh.execution = { backend: 'ssh' };
    expect(validateConfig(ssh)).toEqual(['execution backend "ssh" requires execution.ssh.host']);

    const complete = defaultConfig();
    complete.execution = { backend: 'docker', docker: { image: 'alpine' } };
    expect(validateConfig(complete)).toEqual([]);
  });
});
