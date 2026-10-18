import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Memory, extractFacts, renderEntries } from './memory.js';
import type { SessionMessage } from '../session/session.js';

let home: string;
let projectA: string;
let projectB: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lumps-memory-'));
  projectA = mkdtempSync(join(tmpdir(), 'lumps-project-a-'));
  projectB = mkdtempSync(join(tmpdir(), 'lumps-project-b-'));
  process.env.LUMPSCODE_HOME = home;
});

afterEach(() => {
  delete process.env.LUMPSCODE_HOME;
});

function message(role: SessionMessage['role'], content: string): SessionMessage {
  return { role, content, timestamp: new Date(0) };
}

describe('memory tiers', () => {
  it('stores and retrieves per tier with scoping', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('user', 'style', 'prefers tabs');
    memory.remember('project', 'test_command', 'bun run test');

    expect(memory.get('user', 'style')?.value).toBe('prefers tabs');
    const names = memory.retrieve('tabs', { tiers: ['user'] }).map((entry) => entry.key);
    expect(names).toContain('style');
    expect(memory.retrieve('tabs', { tiers: ['project'] })).toEqual([]);
  });

  it('persists project and user tiers with correct 0600 files', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('user', 'editor', 'vim');
    memory.remember('project', 'build', 'bun build');
    const reloaded = new Memory({ projectDir: projectA });
    expect(reloaded.get('user', 'editor')?.value).toBe('vim');
    expect(reloaded.get('project', 'build')?.value).toBe('bun build');
    const files = readdirSync(join(home, 'memory'));
    expect(files).toContain('user.json');
    for (const file of files) {
      expect(statSync(join(home, 'memory', file)).mode & 0o777).toBe(0o600);
    }
  });

  it('isolates project scopes from each other', () => {
    new Memory({ projectDir: projectA }).remember('project', 'secret_scope', 'a-only');
    const other = new Memory({ projectDir: projectB });
    expect(other.get('project', 'secret_scope')).toBeUndefined();
    const same = new Memory({ projectDir: projectA });
    expect(same.get('project', 'secret_scope')?.value).toBe('a-only');
  });

  it('shares user tier across projects but not temporary or session tiers', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('temporary', 'scratch', 1);
    memory.remember('session', 'current', 2);
    memory.remember('user', 'global', 3);
    const reloaded = new Memory({ projectDir: projectB });
    expect(reloaded.get('user', 'global')?.value).toBe(3);
    expect(reloaded.get('temporary', 'scratch')).toBeUndefined();
    expect(reloaded.get('session', 'current')).toBeUndefined();
  });

  it('redacts secrets at the disk boundary while memory stays lossless', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('user', 'api_key', 'sk-test1234567890abcd');
    const raw = readFileSync(join(home, 'memory', 'user.json'), 'utf8');
    expect(raw).not.toContain('sk-test1234567890abcd');
    expect(raw).toContain('[REDACTED]');
    expect(memory.get('user', 'api_key')?.value).toBe('sk-test1234567890abcd');

    const reloaded = new Memory({ projectDir: projectA });
    expect(reloaded.get('user', 'api_key')?.value).toBe('[REDACTED]');
  });

  it('expires entries by ttl and drops them on reload', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('temporary', 'flash', 'gone', { ttlMs: 5 });
    memory.remember('project', 'stale', 'gone', { ttlMs: 5 });
    expect(memory.get('temporary', 'flash')).toBeDefined();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(memory.get('temporary', 'flash')).toBeUndefined();
        expect(new Memory({ projectDir: projectA }).get('project', 'stale')).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it('evicts the oldest entry when a tier exceeds its budget', () => {
    const memory = new Memory({ projectDir: projectA });
    for (let i = 0; i < 1001; i += 1) memory.remember('temporary', `key-${i}`, i);
    expect(memory.entries('temporary')).toHaveLength(1000);
    expect(memory.get('temporary', 'key-0')).toBeUndefined();
    expect(memory.get('temporary', 'key-1000')?.value).toBe(1000);
  });

  it('forgets keys and clears tiers durably', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('project', 'a', 1);
    memory.remember('project', 'b', 2);
    expect(memory.forget('project', 'a')).toBe(true);
    memory.clear('project');
    const reloaded = new Memory({ projectDir: projectA });
    expect(reloaded.entries('project')).toEqual([]);
  });
});

describe('token-lean retrieval', () => {
  it('ranks key hits above value hits and respects the budget', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.remember('user', 'deploy_target', 'staging cluster');
    memory.remember('user', 'note-1', 'deploy related');
    for (let i = 0; i < 30; i += 1) {
      memory.remember('user', `deploy-${i}`, 'deploy detail');
    }
    const picked = memory.retrieve('deploy', { budgetTokens: 20 });
    expect(picked[0].key).toBe('deploy_target');
    expect(picked.length).toBeLessThan(32);
  });

  it('renders entries as key value lines', () => {
    const memory = new Memory({ projectDir: projectA });
    const entry = memory.remember('user', 'prefs', { theme: 'dark' });
    expect(renderEntries([entry])).toBe('prefs: {"theme":"dark"}');
    expect(memory.retrieve('theme', {})).toHaveLength(1);
  });
});

describe('fact extraction', () => {
  it('passes only conversational turns to the extractor and normalizes facts', async () => {
    const extract = vi.fn(async (_transcript: string) => [
      { key: 'likes', value: 'tabs' },
      { key: ' likes ', value: 'spaces' },
      { key: '', value: 'dropped' },
      { key: 'missing_value', value: undefined },
    ]);
    const facts = await extractFacts(
      [
        message('user', 'I prefer tabs'),
        message('tool', 'SECRET TOOL OUTPUT'),
        message('assistant', 'noted'),
      ],
      extract
    );
    expect(extract).toHaveBeenCalledTimes(1);
    const transcript = extract.mock.calls[0][0];
    expect(transcript).toContain('user: I prefer tabs');
    expect(transcript).not.toContain('SECRET TOOL OUTPUT');
    expect(facts).toEqual([{ key: 'likes', value: 'spaces' }]);
  });

  it('caps facts and skips extraction for empty transcripts', async () => {
    const extract = vi.fn(async () =>
      Array.from({ length: 25 }, (_, i) => ({ key: `fact-${i}`, value: i }))
    );
    const facts = await extractFacts([message('user', 'hello')], extract);
    expect(facts).toHaveLength(20);

    const empty = vi.fn(async () => []);
    expect(await extractFacts([message('tool', 'ignored')], empty)).toEqual([]);
    expect(empty).not.toHaveBeenCalled();
  });

  it('stores extracted facts through rememberFacts', () => {
    const memory = new Memory({ projectDir: projectA });
    memory.rememberFacts('project', [
      { key: 'stack', value: 'bun' },
      { key: 'tests', value: 'vitest' },
    ]);
    expect(new Memory({ projectDir: projectA }).get('project', 'stack')?.value).toBe('bun');
  });
});
