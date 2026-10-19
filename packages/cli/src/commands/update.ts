import { VERSION } from '@larecode/core';

export const REGISTRY_URL = 'https://registry.npmjs.org/larecode/latest';

const ok = (text: string) => `\x1b[32m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;

export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export interface UpdateDeps {
  fetchImpl?: typeof fetch;
  write?: (text: string) => void;
  version?: string;
}

export async function updateCommand(
  options: { check?: boolean },
  deps: UpdateDeps = {}
): Promise<void> {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const current = deps.version ?? VERSION;

  let latest: string;
  try {
    const response = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`registry returned ${response.status}`);
    const data = (await response.json()) as { version?: string };
    if (!data.version) throw new Error('registry response had no version');
    latest = data.version;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    write(`${bad('update:')} registry check failed (${reason})\n`);
    process.exitCode = 1;
    return;
  }

  if (compareVersions(latest, current) <= 0) {
    write(`${ok('✓')} up to date (${current})\n`);
    return;
  }

  write(`${ok('✓')} update available: ${current} -> ${latest}\n`);
  if (options.check) return;
  write(`  npm install -g larecode@${latest}\n`);
  write(`  bun add --global larecode@${latest}\n`);
}
