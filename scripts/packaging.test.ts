import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ASSETS,
  archPkgbuild,
  archSrcinfo,
  generateManifests,
  homebrewFormula,
  scoopManifest,
  type ManifestInput,
} from './packaging.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-packaging-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const input: ManifestInput = {
  version: '1.2.3',
  baseUrl: 'https://github.com/rsyyd/larecode/releases/download/v1.2.3',
  sha256: {
    'linux-x64': 'a'.repeat(64),
    'linux-arm64': 'b'.repeat(64),
    'darwin-x64': 'c'.repeat(64),
    'darwin-arm64': 'd'.repeat(64),
    'windows-x64': 'e'.repeat(64),
  },
};

describe('manifest generation', () => {
  it('renders a homebrew formula pinned to per-platform shas', () => {
    const formula = homebrewFormula(input);
    expect(formula).toContain('class Larecode < Formula');
    expect(formula).toContain('version "1.2.3"');
    expect(formula).toContain(`sha256 "${input.sha256['darwin-arm64']}"`);
    expect(formula).toContain('bin.install Dir["larecode-*"].first => "larecode"');
  });

  it('refuses to render a formula without a sha', () => {
    const incomplete: ManifestInput = { ...input, sha256: { ...input.sha256 } };
    delete incomplete.sha256['darwin-arm64'];
    expect(() => homebrewFormula(incomplete)).toThrow(/missing sha256 for darwin-arm64/);
  });

  it('renders a scoop manifest with autoupdate', () => {
    const manifest = JSON.parse(scoopManifest(input)) as {
      version: string;
      bin: string[][];
      autoupdate: { architecture: { '64bit': { url: string } } };
    };
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.bin).toEqual([['larecode-windows-x64.exe', 'larecode']]);
    expect(manifest.autoupdate.architecture['64bit'].url).toBe(
      'https://github.com/rsyyd/larecode/releases/download/v$version/larecode-windows-x64.exe'
    );
  });

  it('renders a PKGBUILD for both architectures', () => {
    const pkgbuild = archPkgbuild(input);
    expect(pkgbuild).toContain('pkgver=1.2.3');
    expect(pkgbuild).toContain("sha256sums_x86_64=('" + input.sha256['linux-x64'] + "')");
    expect(pkgbuild).toContain("sha256sums_aarch64=('" + input.sha256['linux-arm64'] + "')");
  });

  it('renders a SRCINFO for the AUR', () => {
    const srcinfo = archSrcinfo(input);
    expect(srcinfo).toContain('pkgbase = larecode');
    expect(srcinfo).toContain('pkgver = 1.2.3');
    expect(srcinfo).toContain('sha256sums_x86_64 = ' + input.sha256['linux-x64']);
    expect(srcinfo).toContain('pkgname = larecode');
  });

  it('writes all four manifests from a binaries directory', async () => {
    const binaries = join(dir, 'binaries');
    await (await import('node:fs/promises')).mkdir(binaries, { recursive: true });
    for (const asset of Object.values(ASSETS)) {
      await writeFile(join(binaries, asset), `content of ${asset}`);
    }

    const files = await generateManifests(
      { version: '1.2.3', baseUrl: input.baseUrl },
      binaries,
      join(dir, 'out')
    );
    expect(files).toHaveLength(4);

    const formula = await readFile(join(dir, 'out', 'larecode.rb'), 'utf8');
    const expected = createHash('sha256').update(`content of ${ASSETS['linux-x64']}`).digest('hex');
    expect(formula).toContain(`sha256 "${expected}"`);
  });

  it('refuses to generate when a platform binary is missing', async () => {
    const binaries = join(dir, 'binaries');
    await (await import('node:fs/promises')).mkdir(binaries, { recursive: true });
    await writeFile(join(binaries, ASSETS['windows-x64']), 'windows build');
    await expect(
      generateManifests({ version: '1.2.3', baseUrl: input.baseUrl }, binaries, join(dir, 'out'))
    ).rejects.toThrow(/missing binary .*larecode-linux-x64/);
  });
});
