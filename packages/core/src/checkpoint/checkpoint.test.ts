import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Checkpoints, Worktrees } from './checkpoint.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lare-checkpoint-home-'));
  process.env.LARECODE_HOME = home;
});

afterEach(() => {
  delete process.env.LARECODE_HOME;
});

describe('checkpoints', () => {
  it('rewinds the workspace to a checkpoint and forward again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lare-ws-'));
    writeFileSync(join(root, 'keep.ts'), 'v1');
    writeFileSync(join(root, 'remove-me.ts'), 'gone');
    const checkpoints = new Checkpoints({ root, sessionId: 'session-a' });

    const first = await checkpoints.create('turn 1');
    expect(first?.id).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(join(root, 'keep.ts'), 'v2');
    rmSync(join(root, 'remove-me.ts'));
    writeFileSync(join(root, 'added.ts'), 'new');
    const second = await checkpoints.create('turn 2');
    expect(second).not.toBeNull();

    const result = await checkpoints.rewind(first!.id);
    expect(readFileSync(join(root, 'keep.ts'), 'utf8')).toBe('v1');
    expect(readFileSync(join(root, 'remove-me.ts'), 'utf8')).toBe('gone');
    expect(existsSync(join(root, 'added.ts'))).toBe(false);
    expect(result.removed).toBe(1);

    await checkpoints.rewind(second!.id);
    expect(readFileSync(join(root, 'keep.ts'), 'utf8')).toBe('v2');
    expect(existsSync(join(root, 'added.ts'))).toBe(true);
    expect(existsSync(join(root, 'remove-me.ts'))).toBe(false);
    expect(await checkpoints.list()).toHaveLength(2);
  });

  it('skips duplicate checkpoints when nothing changed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lare-ws-'));
    writeFileSync(join(root, 'a.ts'), '1');
    const checkpoints = new Checkpoints({ root, sessionId: 'session-b' });
    expect(await checkpoints.create('one')).not.toBeNull();
    expect(await checkpoints.create('two')).toBeNull();
    const list = await checkpoints.list();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('one');
  });

  it('keeps untracked files when removal is disabled and respects ignores', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lare-ws-'));
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'tracked.ts'), 'v1');
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.js'), 'dep-v1');
    const checkpoints = new Checkpoints({ root, sessionId: 'session-c' });
    const first = await checkpoints.create('turn 1');

    writeFileSync(join(root, 'tracked.ts'), 'v2');
    writeFileSync(join(root, 'ignored.txt'), 'local-only');
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.js'), 'dep-v2');
    writeFileSync(join(root, 'scratch.ts'), 'temp');

    await checkpoints.rewind(first!.id, { removeUntracked: false });
    expect(readFileSync(join(root, 'tracked.ts'), 'utf8')).toBe('v1');
    expect(existsSync(join(root, 'scratch.ts'))).toBe(true);
    expect(existsSync(join(root, 'ignored.txt'))).toBe(true);
    expect(readFileSync(join(root, 'node_modules', 'pkg', 'x.js'), 'utf8')).toBe('dep-v2');

    await checkpoints.rewind(first!.id);
    expect(existsSync(join(root, 'scratch.ts'))).toBe(false);
    expect(existsSync(join(root, 'ignored.txt'))).toBe(true);
  });

  it('rejects invalid checkpoint ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lare-ws-'));
    writeFileSync(join(root, 'a.ts'), '1');
    const checkpoints = new Checkpoints({ root, sessionId: 'session-d' });
    await checkpoints.create('one');
    await expect(checkpoints.rewind('HEAD~1')).rejects.toThrow('invalid checkpoint id');
    await expect(checkpoints.rewind('zzzzzzz')).rejects.toThrow('invalid checkpoint id');
  });

  it('reports no checkpoints for a fresh session before rewind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lare-ws-'));
    const checkpoints = new Checkpoints({ root, sessionId: 'session-e' });
    expect(await checkpoints.list()).toEqual([]);
    await expect(checkpoints.rewind('abc1234')).rejects.toThrow('no checkpoints recorded');
  });
});

describe('worktrees', () => {
  function initRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'lare-repo-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=test',
          '-c',
          'user.email=test@test.local',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: repo, encoding: 'utf8' }
      );
    git('init', '-q');
    writeFileSync(join(repo, 'file.txt'), 'base');
    git('add', '.');
    git('commit', '-qm', 'init');
    return repo;
  }

  it('creates, lists, and removes worktrees with their branch', async () => {
    const repo = initRepo();
    const worktrees = new Worktrees({ root: repo });
    const info = await worktrees.create('feature-x');
    expect(info.branch).toBe('larecode/feature-x');
    expect(readFileSync(join(info.path, 'file.txt'), 'utf8')).toBe('base');

    const listed = await worktrees.list();
    expect(listed.some((entry) => entry.branch === 'larecode/feature-x')).toBe(true);

    await worktrees.remove('feature-x');
    expect(existsSync(info.path)).toBe(false);
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list'], { encoding: 'utf8' });
    expect(branches).not.toContain('larecode/feature-x');
  });

  it('rejects unsafe worktree names', async () => {
    const repo = initRepo();
    const worktrees = new Worktrees({ root: repo });
    await expect(worktrees.create('../evil')).rejects.toThrow('invalid worktree name');
    await expect(worktrees.create('..')).rejects.toThrow('invalid worktree name');
    await expect(worktrees.create('.hidden')).rejects.toThrow('invalid worktree name');
  });

  it('fails with GIT_OPERATION_FAILED outside a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'lare-plain-'));
    const worktrees = new Worktrees({ root: plain });
    await expect(worktrees.create('nope')).rejects.toThrow(/not a git repository/i);
  });
});
