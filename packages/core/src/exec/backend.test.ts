import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LareError } from '../error/error.js';
import { Permissions } from '../permission/permission.js';
import { bashTool } from '../tool/bash.js';
import type { ToolContext } from '../tool/tool.js';
import {
  DockerBackend,
  LocalBackend,
  SshBackend,
  backendFromConfig,
  dockerArgs,
  shellQuote,
  sshArgs,
} from './backend.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-exec-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const request = (command: string) => ({
  command,
  cwd: dir,
  timeoutMs: 5_000,
  abortSignal: new AbortController().signal,
});

function context(): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: dir,
    permissions: new Permissions(),
    abortSignal: new AbortController().signal,
  };
}

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function fakeBinary(
  name: string,
  body = '#!/bin/sh\necho "argv:$@"\nexit 0\n'
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

describe('dockerArgs', () => {
  it('isolates by default and mounts the workspace at its own path', () => {
    const args = dockerArgs(request('echo hi'), { image: 'node:22-alpine' });
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '-i']);
    expect(args).toContain('--network');
    expect(args[args.indexOf('--network') + 1]).toBe('none');
    expect(args[args.indexOf('-v') + 1]).toBe(`${dir}:${dir}`);
    expect(args[args.indexOf('-w') + 1]).toBe(dir);
    expect(args.slice(-4)).toEqual(['node:22-alpine', 'sh', '-lc', 'echo hi']);
  });

  it('honours network, user, and extra args', () => {
    const args = dockerArgs(request('ls'), {
      image: 'alpine',
      network: true,
      user: '1000:1000',
      args: ['--memory', '512m'],
    });
    expect(args).not.toContain('--network');
    expect(args).toContain('--user');
    expect(args.slice(args.indexOf('--memory'), args.indexOf('--memory') + 2)).toEqual([
      '--memory',
      '512m',
    ]);
    expect(args.indexOf('alpine')).toBeGreaterThan(args.indexOf('--memory'));
  });
});

describe('sshArgs', () => {
  it('builds a batch-mode command with a quoted cd', () => {
    const args = sshArgs(request('echo hi'), {
      host: 'box',
      user: 'dev',
      port: 2222,
      identityFile: '/keys/id',
    });
    expect(args).toContain('BatchMode=yes');
    expect(args.slice(-2)).toEqual(['dev@box', `cd '${dir}' && echo hi`]);
    expect(args).toContain('-p');
    expect(args).toContain('-i');
  });

  it('quotes apostrophes in the working directory', () => {
    expect(shellQuote(`/tmp/it's`)).toBe(`'/tmp/it'\\''s'`);
  });
});

describe('backends', () => {
  it('runs locally by default', async () => {
    const result = await new LocalBackend().exec(request('echo local-ok'));
    expect(result.stdout.trim()).toBe('local-ok');
    expect(result.exitCode).toBe(0);
  });

  it('kills the process group when the turn is aborted', async () => {
    const controller = new AbortController();
    const pending = new LocalBackend().exec({
      ...request('sleep 30 & echo $! > child.pid; echo $$ > shell.pid; wait'),
      abortSignal: controller.signal,
    });
    const childPid = Number(await waitForFile(join(dir, 'child.pid')));
    const shellPid = Number(await waitForFile(join(dir, 'shell.pid')));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await waitForExit(childPid)).toBe(true);
    expect(await waitForExit(shellPid)).toBe(true);
  });

  it('runs docker with a stand-in binary', async () => {
    const binary = await fakeBinary('fake-docker.sh');
    const backend = new DockerBackend({ image: 'alpine', binary });
    const result = await backend.exec(request('echo inside'));
    expect(result.stdout).toContain('argv:run --rm -i --network none');
    expect(result.stdout).toContain('alpine sh -lc echo inside');
  });

  it('runs ssh with a stand-in binary', async () => {
    const binary = await fakeBinary('fake-ssh.sh');
    const backend = new SshBackend({ host: 'box', user: 'dev', binary });
    const result = await backend.exec(request('echo inside'));
    expect(result.stdout).toContain('-o BatchMode=yes');
    expect(result.stdout).toContain(`dev@box cd '${dir}' && echo inside`);
  });

  it('routes the bash tool through the docker backend', async () => {
    const binary = await fakeBinary('fake-docker.sh');
    const tool = bashTool(new DockerBackend({ image: 'node:22-alpine', binary }));
    const output = (await tool.execute({ command: 'echo routed' }, context())) as {
      backend: string;
      stdout: string;
      exitCode: number;
    };
    expect(output.backend).toBe('docker');
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain('argv:run');
    expect(output.stdout).toContain('node:22-alpine sh -lc echo routed');
  });
});

describe('backendFromConfig', () => {
  it('falls back to local', () => {
    expect(backendFromConfig({}).name).toBe('local');
    expect(backendFromConfig({ execution: { backend: 'local' } }).name).toBe('local');
  });

  it('builds docker and ssh backends', () => {
    expect(
      backendFromConfig({ execution: { backend: 'docker', docker: { image: 'alpine' } } }).name
    ).toBe('docker');
    expect(backendFromConfig({ execution: { backend: 'ssh', ssh: { host: 'box' } } }).name).toBe(
      'ssh'
    );
  });

  it('rejects incomplete configuration', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as LareError).code;
      }
      return undefined;
    };
    expect(code(() => backendFromConfig({ execution: { backend: 'docker' } }))).toBe(
      'CONFIG_INVALID'
    );
    expect(code(() => backendFromConfig({ execution: { backend: 'ssh' } }))).toBe('CONFIG_INVALID');
  });
});
