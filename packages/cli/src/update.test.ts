import { afterEach, describe, expect, it } from 'vitest';
import { REGISTRY_URL, compareVersions, installHints, updateCommand } from './commands/update.js';

function harness(response: unknown, options: { fail?: Error } = {}) {
  const out: string[] = [];
  const fetchImpl = (async () => {
    if (options.fail) throw options.fail;
    return { ok: true, json: async () => response } as unknown as Response;
  }) as typeof fetch;
  return { out, fetchImpl, write: (text: string) => out.push(text) };
}

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

describe('compareVersions', () => {
  it('orders versions numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('0.0.0', '0.0.0')).toBe(0);
    expect(compareVersions('v0.0.1', '0.0.0')).toBe(1);
    expect(compareVersions('0.0.0', '0.1.0')).toBe(-1);
  });
});

describe('installHints', () => {
  it('picks the hint by install method', () => {
    expect(installHints('/opt/homebrew/bin/larecode', '1.0.0')).toEqual(['brew upgrade larecode']);
    expect(installHints('C:\\Users\\x\\scoop\\shims\\larecode.exe', '1.0.0')).toEqual([
      'scoop update larecode',
    ]);
    expect(installHints('/usr/local/bin/node', '1.0.0')[0]).toContain('npm install');
    expect(installHints('/tmp/larecode-bin', '1.0.0')[0]).toContain('release binary');
  });
});

describe('updateCommand', () => {
  it('reports an available update and how to upgrade', async () => {
    const { out, fetchImpl, write } = harness({ version: '9.9.9' });
    await updateCommand({}, { fetchImpl, write, version: '0.0.0', execPath: '/usr/local/bin/bun' });
    expect(out.join('')).toContain('update available: 0.0.0 -> 9.9.9');
    expect(out.join('')).toContain('npm install -g larecode@9.9.9');
  });

  it('suggests brew when larecode was installed with homebrew', async () => {
    const { out, fetchImpl, write } = harness({ version: '9.9.9' });
    await updateCommand(
      {},
      { fetchImpl, write, version: '0.0.0', execPath: '/opt/homebrew/bin/bun' }
    );
    expect(out.join('')).toContain('brew upgrade larecode');
  });

  it('reports only the fact with --check', async () => {
    const { out, fetchImpl, write } = harness({ version: '9.9.9' });
    await updateCommand({ check: true }, { fetchImpl, write, version: '0.0.0' });
    expect(out.join('')).toContain('update available');
    expect(out.join('')).not.toContain('npm install');
  });

  it('confirms when already current', async () => {
    const { out, fetchImpl, write } = harness({ version: '0.0.0' });
    await updateCommand({}, { fetchImpl, write, version: '0.0.0' });
    expect(out.join('')).toContain('up to date (0.0.0)');
    expect(out.join('')).not.toContain('update available');
  });

  it('fails cleanly when the registry is unreachable', async () => {
    const { out, fetchImpl, write } = harness({}, { fail: new Error('offline') });
    await updateCommand({}, { fetchImpl, write, version: '0.0.0' });
    expect(out.join('')).toContain('registry check failed (offline)');
    expect(process.exitCode).toBe(1);
  });

  it('queries the npm registry', async () => {
    let called = '';
    const fetchImpl = (async (url: string | URL | Request) => {
      called = String(url);
      return { ok: true, json: async () => ({ version: '0.0.0' }) } as unknown as Response;
    }) as typeof fetch;
    await updateCommand({}, { fetchImpl, write: () => {}, version: '0.0.0' });
    expect(called).toBe(REGISTRY_URL);
  });
});
