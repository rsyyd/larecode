import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TestRun {
  command: string;
  exitCode: number;
  output: string;
}

export interface VerifyReport {
  baselineFailures: string[];
  afterFailures: string[];
  newFailures: string[];
  fixedFailures: string[];
  passed: boolean;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const FAILURE_LINE = /^\s*(?:[×✗✖]|\(fail\)|FAILED|FAIL)\s*(.+?)\s*$/;
const DURATION = /\s+\d+(?:\.\d+)?m?s$/;
const BRACKET_DURATION = /\s*\[[\d.]+m?s\]$/;
const PYTEST_REASON = /\s+-\s+.*$/;

export function parseFailures(output: string): string[] {
  const failures = new Set<string>();
  for (const rawLine of output.replace(ANSI, '').split('\n')) {
    const match = FAILURE_LINE.exec(rawLine);
    if (!match) continue;
    const name = match[1]
      .replace(DURATION, '')
      .replace(BRACKET_DURATION, '')
      .replace(PYTEST_REASON, '')
      .trim();
    if (name) failures.add(name);
  }
  return [...failures];
}

export function compareRuns(baseline: TestRun, after: TestRun): VerifyReport {
  const baselineFailures = new Set(parseFailures(baseline.output));
  const afterFailures = parseFailures(after.output);
  const newFailures = afterFailures.filter((name) => !baselineFailures.has(name));
  const fixedFailures = [...baselineFailures].filter((name) => !afterFailures.includes(name));
  const passed = newFailures.length === 0 && (after.exitCode === 0 || afterFailures.length > 0);
  return {
    baselineFailures: [...baselineFailures],
    afterFailures,
    newFailures,
    fixedFailures,
    passed,
  };
}

export function runTestCommand(
  command: string,
  options: { cwd?: string; timeoutMs?: number } = {}
): TestRun {
  const result = spawnSync('sh', ['-c', command], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 600_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { command, exitCode: result.status ?? 1, output };
}

export function detectTestCommand(dir: string = process.cwd()): string | null {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return null;
  let scripts: Record<string, string> | undefined;
  try {
    scripts = (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> })
      .scripts;
  } catch {
    return null;
  }
  if (!scripts?.test) return null;
  const runner = existsSync(join(dir, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(dir, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(dir, 'package-lock.json'))
        ? 'npm'
        : 'bun';
  return `${runner} run test`;
}
