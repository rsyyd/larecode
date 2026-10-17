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
} from './config.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lumpscode-config-'));
  process.env.LUMPSCODE_HOME = home;
});

afterEach(() => {
  delete process.env.LUMPSCODE_HOME;
});

describe('config', () => {
  it('defaults to openai-compatible with ollama available', () => {
    const config = defaultConfig();
    expect(config.defaultProvider).toBe('openai-compatible');
    expect(Object.keys(config.providers)).toContain('ollama');
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

  it('lets a project lumpscode.json override the global config', () => {
    const project = mkdtempSync(join(tmpdir(), 'lumpscode-project-'));
    writeFileSync(
      join(project, 'lumpscode.json'),
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
});
