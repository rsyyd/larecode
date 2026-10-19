import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ManifestInput {
  version: string;
  baseUrl: string;
  sha256: {
    'linux-x64'?: string;
    'linux-arm64'?: string;
    'darwin-x64'?: string;
    'darwin-arm64'?: string;
    'windows-x64'?: string;
  };
}

export const ASSETS: Record<keyof ManifestInput['sha256'], string> = {
  'linux-x64': 'lumpscode-linux-x64',
  'linux-arm64': 'lumpscode-linux-arm64',
  'darwin-x64': 'lumpscode-darwin-x64',
  'darwin-arm64': 'lumpscode-darwin-arm64',
  'windows-x64': 'lumpscode-windows-x64.exe',
};

function requireSha(input: ManifestInput, key: keyof ManifestInput['sha256']): string {
  const sha = input.sha256[key];
  if (!sha) throw new Error(`missing sha256 for ${key}`);
  return sha;
}

function url(input: ManifestInput, key: keyof ManifestInput['sha256']): string {
  return `${input.baseUrl}/${ASSETS[key]}`;
}

export function homebrewFormula(input: ManifestInput): string {
  return `class Lumpscode < Formula
  desc "Provider-neutral AI coding agent for the terminal"
  homepage "https://github.com/rsyyd/lumpscode"
  version "${input.version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${url(input, 'darwin-arm64')}"
      sha256 "${requireSha(input, 'darwin-arm64')}"
    end

    on_intel do
      url "${url(input, 'darwin-x64')}"
      sha256 "${requireSha(input, 'darwin-x64')}"
    end
  end

  on_linux do
    on_arm do
      url "${url(input, 'linux-arm64')}"
      sha256 "${requireSha(input, 'linux-arm64')}"
    end

    on_intel do
      url "${url(input, 'linux-x64')}"
      sha256 "${requireSha(input, 'linux-x64')}"
    end
  end

  def install
    bin.install Dir["lumpscode-*"].first => "lumpscode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/lumpscode --version")
  end
end
`;
}

export function scoopManifest(input: ManifestInput): string {
  return `${JSON.stringify(
    {
      version: input.version,
      description: 'Provider-neutral AI coding agent for the terminal',
      homepage: 'https://github.com/rsyyd/lumpscode',
      license: 'MIT',
      architecture: {
        '64bit': {
          url: url(input, 'windows-x64'),
          hash: requireSha(input, 'windows-x64'),
        },
      },
      bin: [[ASSETS['windows-x64'], 'lumpscode']],
      checkver: {
        github: 'https://github.com/rsyyd/lumpscode',
      },
      autoupdate: {
        architecture: {
          '64bit': {
            url: `${input.baseUrl.replace(/\/v[^/]+$/, '')}/v$version/${ASSETS['windows-x64']}`,
          },
        },
      },
    },
    null,
    2
  )}\n`;
}

export function archPkgbuild(input: ManifestInput): string {
  return `# Maintainer: rsyyd <rsyyd@users.noreply.github.com>
pkgname=lumpscode
pkgver=${input.version}
pkgrel=1
pkgdesc="Provider-neutral AI coding agent for the terminal"
arch=('x86_64' 'aarch64')
url="https://github.com/rsyyd/lumpscode"
license=('MIT')
provides=('lumpscode')
conflicts=('lumpscode-bin')
source_x86_64=("lumpscode-linux-x64::${url(input, 'linux-x64')}")
source_aarch64=("lumpscode-linux-arm64::${url(input, 'linux-arm64')}")
sha256sums_x86_64=('${requireSha(input, 'linux-x64')}')
sha256sums_aarch64=('${requireSha(input, 'linux-arm64')}')

package() {
  install -Dm755 "$srcdir/lumpscode-linux-x64" "$pkgdir/usr/bin/lumpscode"
}

package_aarch64() {
  install -Dm755 "$srcdir/lumpscode-linux-arm64" "$pkgdir/usr/bin/lumpscode"
}
`;
}

export async function generateManifests(
  options: { version: string; baseUrl: string },
  binariesDir: string,
  outDir: string
): Promise<string[]> {
  const sha256: ManifestInput['sha256'] = {};
  for (const key of Object.keys(ASSETS) as (keyof ManifestInput['sha256'])[]) {
    const path = join(binariesDir, ASSETS[key]);
    try {
      sha256[key] = await sha256Of(path);
    } catch {
      throw new Error(`packaging: missing binary ${path}`);
    }
  }

  const input: ManifestInput = { ...options, sha256 };
  await mkdir(outDir, { recursive: true });
  const files: [string, string][] = [
    ['lumpscode.rb', homebrewFormula(input)],
    ['lumpscode.json', scoopManifest(input)],
    ['PKGBUILD', archPkgbuild(input)],
  ];
  for (const [name, content] of files) {
    await writeFile(join(outDir, name), content);
  }
  return files.map(([name]) => join(outDir, name));
}

async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function main(argv: string[]): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key && value) args.set(key, value);
  }

  const version = args.get('version');
  const binaries = args.get('binaries');
  const baseUrl =
    args.get('base-url') ?? `https://github.com/rsyyd/lumpscode/releases/download/v${version}`;
  const outDir = args.get('out') ?? 'packaging/out';
  if (!version || !binaries) {
    console.error(
      'usage: bun run scripts/packaging.ts --version <v> --binaries <dir> [--base-url <url>] [--out <dir>]'
    );
    process.exitCode = 1;
    return;
  }

  const files = await generateManifests({ version, baseUrl }, binaries, outDir);
  for (const file of files) console.log(`packaging: wrote ${file}`);
}

if (process.argv[1]?.endsWith('packaging.ts')) {
  await main(process.argv.slice(2));
}
