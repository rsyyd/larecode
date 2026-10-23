import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@larecode/core';
import { buildConfig, firstRunHint, setupCommand } from './commands/setup.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-setup-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

const baseConfig = (): Config => ({
  version: '0.0.0',
  defaultProvider: 'openai-compatible',
  defaultModel: 'gpt-4o',
  permissions: { mode: 'ask', allowedGroups: ['read'] },
  providers: {},
  mcpServers: {},
});

describe('buildConfig', () => {
  it('creates a provider from scratch with defaults', () => {
    const { config, provider, model } = buildConfig(baseConfig(), {});
    expect(provider).toBe('openai-compatible');
    expect(model).toBe(config.providers[provider].models[0]);
    expect(config.providers[provider].baseUrl).toBeTruthy();
  });

  it('applies overrides and keeps existing keys', () => {
    const base = baseConfig();
    base.providers['local'] = {
      type: 'openai-compatible',
      baseUrl: 'http://old',
      models: ['a', 'b'],
    };
    const { config, provider, model } = buildConfig(base, {
      provider: 'local',
      model: 'b',
      apiKey: 'sk-test',
    });
    expect(provider).toBe('local');
    expect(model).toBe('b');
    expect(config.providers['local'].baseUrl).toBe('http://old');
    expect(config.providers['local'].models).toEqual(['b', 'a']);
    expect(config.providers['local'].apiKey).toBe('sk-test');
    expect(config.defaultProvider).toBe('local');
  });

  it('switches provider type and url when asked', () => {
    const { config } = buildConfig(baseConfig(), {
      provider: 'anthropic',
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-3-5-sonnet',
    });
    expect(config.providers['anthropic']).toEqual({
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-3-5-sonnet'],
    });
    expect(config.defaultModel).toBe('claude-3-5-sonnet');
  });
});

describe('first run', () => {
  it('points an unconfigured user at setup without blocking the first turn', () => {
    const out: string[] = [];
    const shown = firstRunHint({
      path: join(dir, 'missing.json'),
      write: (text) => out.push(text),
    });
    expect(shown).toBe(true);
    expect(out.join('')).toContain('larecode setup');
  });

  it('stays quiet once a config exists', () => {
    const out: string[] = [];
    const shown = firstRunHint({
      path: join(dir, 'config.json'),
      exists: () => true,
      write: (text) => out.push(text),
    });
    expect(shown).toBe(false);
    expect(out).toEqual([]);
  });
});

describe('setupCommand', () => {
  const harness = () => {
    const out: string[] = [];
    return { out, write: (text: string) => out.push(text) };
  };

  it('writes a fresh config that doctor would accept', async () => {
    const path = join(dir, 'config.json');
    const { out, write } = harness();
    await setupCommand({}, { path, write });
    const written = JSON.parse(await readFile(path, 'utf8')) as Config;
    expect(written.defaultProvider).toBe('openai-compatible');
    expect(out.join('')).toContain('wrote');
    expect(out.join('')).toContain('next:');
  });

  it('rejects an invalid base URL without writing a config', async () => {
    const path = join(dir, 'config.json');
    const { out, write } = harness();
    await setupCommand({ baseUrl: 'not a url' }, { path, write });

    expect(out.join('')).toContain('invalid base URL');
    expect(existsSync(path)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('rejects an empty model', async () => {
    const path = join(dir, 'config.json');
    const { out, write } = harness();
    await setupCommand({ model: '   ' }, { path, write });

    expect(out.join('')).toContain('model cannot be empty');
    expect(existsSync(path)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('prompts for a provider when run interactively', async () => {
    const path = join(dir, 'config.json');
    const { out, write } = harness();
    const answers = ['2', 'https://api.anthropic.com', 'claude-3-5-sonnet-latest', 'sk-ant-test'];
    const ask = async (): Promise<string> => answers.shift() ?? '';
    await setupCommand({}, { path, write, ask });

    const written = JSON.parse(await readFile(path, 'utf8')) as Config;
    expect(written.defaultProvider).toBe('anthropic');
    expect(written.defaultModel).toBe('claude-3-5-sonnet-latest');
    expect(Object.keys(written.providers)).toEqual(['anthropic']);
    expect(written.providers['anthropic']).toMatchObject({
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-3-5-sonnet-latest'],
      apiKey: 'sk-ant-test',
    });
    expect(out.join('')).toContain('wrote');
  });

  it('refuses to overwrite without --force', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, '{}');
    const { out, write } = harness();
    await setupCommand({}, { path, write });
    expect(out.join('')).toContain('already exists');
    expect(process.exitCode).toBe(1);
  });

  it('overwrites with --force', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, '{}');
    const { out, write } = harness();
    await setupCommand({ provider: 'ollama', force: true }, { path, write });
    const written = JSON.parse(await readFile(path, 'utf8')) as Config;
    expect(written.defaultProvider).toBe('ollama');
    expect(out.join('')).toContain('ollama');
  });

  it('runs the interactive prompts in Indonesian with locale id', async () => {
    const path = join(dir, 'config.json');
    const { out, write } = harness();
    const questions: string[] = [];
    const answers = ['', '', ''];
    const ask = async (question: string, fallback?: string): Promise<string> => {
      questions.push(`${question}${fallback ? `[${fallback}]` : ''}`);
      return answers.shift() ?? '';
    };
    await setupCommand({}, { path, write, ask, locale: 'id' });
    expect(questions[0]).toContain('Provider [1] OpenAI-compatible');
    expect(questions.join('')).toContain('API key (kosongkan untuk diisi nanti)');
    expect(out.join('')).toContain('menulis');
    expect(out.join('')).toContain('lanjut: larecode doctor');
  });

  it('honors LARECODE_LOCALE for the first-run hint', () => {
    vi.stubEnv('LARECODE_LOCALE', 'id');
    const out: string[] = [];
    firstRunHint({ path: join(dir, 'missing.json'), write: (text) => out.push(text) });
    expect(out.join('')).toContain('tidak ada konfigurasi');
    expect(out.join('')).toContain('`larecode setup`');
  });
});
