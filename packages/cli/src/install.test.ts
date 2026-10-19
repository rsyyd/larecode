import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const installSh = fileURLToPath(new URL('../../../install.sh', import.meta.url));
const assetName = () =>
  `lumpscode-${process.platform === 'darwin' ? 'darwin' : 'linux'}-${
    process.arch === 'arm64' ? 'arm64' : 'x64'
  }`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumps-install-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fakeRelease(body: string): Promise<{ base: string; sha: string }> {
  const release = join(dir, 'release');
  await (await import('node:fs/promises')).mkdir(release, { recursive: true });
  const file = join(release, assetName());
  await writeFile(file, body);
  await chmod(file, 0o755);
  const sha = createHash('sha256').update(body).digest('hex');
  return { base: `file://${release}`, sha };
}

function runInstaller(base: string, env: Record<string, string> = {}): string {
  const installDir = join(dir, 'bin');
  return execFileSync('sh', [installSh], {
    env: {
      ...process.env,
      LUMPSCODE_INSTALL_BASE: base,
      LUMPSCODE_INSTALL_DIR: installDir,
      ...env,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('install.sh', () => {
  it('downloads, installs, and leaves a runnable binary', async () => {
    const { base } = await fakeRelease('#!/bin/sh\necho 9.9.9\n');
    const output = runInstaller(base);
    expect(output).toContain('installed to');
    const installed = join(dir, 'bin', 'lumpscode');
    const run = execFileSync('sh', [installed], { encoding: 'utf8' });
    expect(run.trim()).toBe('9.9.9');
  });

  it('verifies the checksum when provided', async () => {
    const { base, sha } = await fakeRelease('#!/bin/sh\necho ok\n');
    runInstaller(base, { LUMPSCODE_SHA256: sha });
    const wrong = createHash('sha256').update('other').digest('hex');
    expect(() => runInstaller(base, { LUMPSCODE_SHA256: wrong })).toThrow(/checksum mismatch/);
  });

  it('fails cleanly when the download is missing', async () => {
    await fakeRelease('#!/bin/sh\necho ok\n');
    expect(() => runInstaller(`file://${join(dir, 'empty')}`)).toThrow(/download failed/);
  });

  it('rejects binaries that cannot run', async () => {
    const { base } = await fakeRelease('not a binary\n');
    expect(() => runInstaller(base)).toThrow(/failed to run/);
  });
});
