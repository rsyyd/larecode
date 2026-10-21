import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { larecodeHome } from '../config/config.js';
import { LareError } from '../error/error.js';

const run = promisify(execFile);

const SAFE_SESSION = /^[A-Za-z0-9_-]{1,128}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const WORKTREE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

const SHADOW_EXCLUDES = [
  'node_modules/',
  'dist/',
  'coverage/',
  'target/',
  '__pycache__/',
  '.venv/',
  '.larecode/',
];

export function checkpointsDir(): string {
  return join(larecodeHome(), 'checkpoints');
}

export function removeSessionCheckpoints(sessionId: string): number {
  if (!SAFE_SESSION.test(sessionId)) return 0;
  const dir = checkpointsDir();
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(`-${sessionId}.git`)) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export interface CheckpointInfo {
  id: string;
  label: string;
  createdAt: Date;
}

export interface RewindResult {
  removed: number;
}

export interface CheckpointOptions {
  root: string;
  sessionId: string;
  home?: string;
  gitBin?: string;
}

function gitFailure(error: unknown, args: string[]): LareError {
  const err = error as { stderr?: string; message?: string; code?: number };
  const detail = err.stderr?.trim() || err.message || 'git command failed';
  return new LareError('GIT_OPERATION_FAILED', detail, {
    cause: error instanceof Error ? error : undefined,
    context: { args: args.join(' '), exitCode: err.code },
  });
}

export class Checkpoints {
  private readonly root: string;
  private readonly gitDir: string;
  private readonly gitBin: string;

  constructor(options: CheckpointOptions) {
    if (!SAFE_SESSION.test(options.sessionId)) {
      throw new LareError('GIT_OPERATION_FAILED', `unsafe session id: ${options.sessionId}`);
    }
    this.root = options.root;
    this.gitBin = options.gitBin ?? 'git';
    const home = options.home ?? larecodeHome();
    const scope = createHash('sha256').update(options.root).digest('hex').slice(0, 16);
    this.gitDir = join(home, 'checkpoints', `${scope}-${options.sessionId}.git`);
  }

  private args(...rest: string[]): string[] {
    return [`--git-dir=${this.gitDir}`, `--work-tree=${this.root}`, ...rest];
  }

  private async run(...rest: string[]): Promise<string> {
    try {
      const { stdout } = await run(this.gitBin, this.args(...rest), { cwd: this.root });
      return stdout;
    } catch (error) {
      throw gitFailure(error, rest);
    }
  }

  private async changed(): Promise<boolean> {
    try {
      await run(this.gitBin, this.args('diff', '--cached', '--quiet'), { cwd: this.root });
      return false;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return true;
      throw gitFailure(error, ['diff', '--cached', '--quiet']);
    }
  }

  private async ensure(): Promise<void> {
    if (existsSync(join(this.gitDir, 'HEAD'))) return;
    mkdirSync(this.gitDir, { recursive: true });
    await this.run('init', '-q');
    writeFileSync(join(this.gitDir, 'info', 'exclude'), SHADOW_EXCLUDES.join('\n') + '\n');
  }

  async create(label = 'checkpoint'): Promise<CheckpointInfo | null> {
    await this.ensure();
    await this.run('add', '-A');
    if (!(await this.changed())) return null;
    const clean = label.replace(/\s+/g, ' ').trim().slice(0, 200) || 'checkpoint';
    await this.run(
      '-c',
      'user.name=larecode',
      '-c',
      'user.email=checkpoint@larecode.local',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      clean
    );
    const id = (await this.run('rev-parse', 'HEAD')).trim();
    const createdAt = new Date((await this.run('log', '-1', '--format=%cI')).trim());
    return { id, label: clean, createdAt };
  }

  async list(): Promise<CheckpointInfo[]> {
    if (!existsSync(join(this.gitDir, 'HEAD'))) return [];
    let output: string;
    try {
      output = await this.run('log', '--format=%H%x1f%cI%x1f%s');
    } catch {
      return [];
    }
    return output
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [id, iso, label] = line.split('\x1f');
        return { id, label, createdAt: new Date(iso) };
      });
  }

  async rewind(id: string, options: { removeUntracked?: boolean } = {}): Promise<RewindResult> {
    if (!SHA_RE.test(id)) {
      throw new LareError('GIT_OPERATION_FAILED', `invalid checkpoint id: ${id}`);
    }
    if (!existsSync(join(this.gitDir, 'HEAD'))) {
      throw new LareError('GIT_OPERATION_FAILED', 'no checkpoints recorded for this session');
    }
    const indexFile = join(this.gitDir, `tmp-index-${process.pid}`);
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    try {
      await run(this.gitBin, this.args('checkout', '-f', id, '--', '.'), {
        cwd: this.root,
        env,
      });
      let removed = 0;
      if (options.removeUntracked ?? true) {
        const { stdout } = await run(this.gitBin, this.args('clean', '-fd'), {
          cwd: this.root,
          env,
        });
        removed = stdout.trim() === '' ? 0 : stdout.trim().split('\n').length;
      }
      return { removed };
    } catch (error) {
      throw gitFailure(error, ['rewind', id]);
    } finally {
      rmSync(indexFile, { force: true });
    }
  }
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
}

export interface WorktreeOptions {
  root: string;
  gitBin?: string;
}

export function worktreesDir(root: string): string {
  return join(root, '.larecode', 'worktrees');
}

export class Worktrees {
  private readonly root: string;
  private readonly gitBin: string;

  constructor(options: WorktreeOptions) {
    this.root = options.root;
    this.gitBin = options.gitBin ?? 'git';
  }

  private async run(...rest: string[]): Promise<string> {
    try {
      const { stdout } = await run(this.gitBin, rest, { cwd: this.root });
      return stdout;
    } catch (error) {
      throw gitFailure(error, rest);
    }
  }

  private pathFor(name: string): string {
    return join(worktreesDir(this.root), name);
  }

  private validateName(name: string): void {
    if (!WORKTREE_NAME_RE.test(name) || name.includes('..')) {
      throw new LareError('GIT_OPERATION_FAILED', `invalid worktree name: ${name}`);
    }
  }

  async create(name: string, options: { base?: string } = {}): Promise<WorktreeInfo> {
    this.validateName(name);
    const path = this.pathFor(name);
    mkdirSync(dirname(path), { recursive: true });
    const branch = `larecode/${name}`;
    const args = ['worktree', 'add', '-b', branch, path];
    if (options.base) args.push(options.base);
    await this.run(...args);
    return { path, branch, head: (await this.run('rev-parse', 'HEAD')).trim() };
  }

  async list(): Promise<WorktreeInfo[]> {
    const output = await this.run('worktree', 'list', '--porcelain');
    const entries: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line.trim() === '' && current.path) {
        entries.push({
          path: current.path,
          head: current.head ?? '',
          branch: current.branch ?? '(detached)',
        });
        current = {};
      }
    }
    if (current.path) {
      entries.push({
        path: current.path,
        head: current.head ?? '',
        branch: current.branch ?? '(detached)',
      });
    }
    return entries;
  }

  async remove(
    name: string,
    options: { force?: boolean; deleteBranch?: boolean } = {}
  ): Promise<void> {
    this.validateName(name);
    const path = this.pathFor(name);
    await this.run('worktree', 'remove', ...(options.force ? ['--force'] : []), path);
    if (options.deleteBranch ?? true) {
      await this.run('branch', '-D', `larecode/${name}`);
    }
  }
}
