import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareRuns,
  detectTestCommand,
  parseFailures,
  runTestCommand,
  type TestRun,
} from './verify.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lumpscode-verify-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (output: string, exitCode: number): TestRun => ({ command: 'x', exitCode, output });

describe('parseFailures', () => {
  it('reads vitest, bun, jest, and pytest failure lines', () => {
    const output = [
      '\x1b[31m×\x1b[0m suite > detects the bug 111ms',
      '✗ streams tokens 12ms',
      '(fail) pre-existing bug [0.88ms]',
      'FAIL path/to/file.test.js',
      'FAILED tests/api.py::test_charge - AssertionError: boom',
      'passed stuff',
    ].join('\n');
    expect(parseFailures(output)).toEqual([
      'suite > detects the bug',
      'streams tokens',
      'pre-existing bug',
      'path/to/file.test.js',
      'tests/api.py::test_charge',
    ]);
  });

  it('deduplicates repeated failure lines', () => {
    expect(parseFailures('× same test\n× same test\n')).toEqual(['same test']);
  });

  it('returns nothing for a green run', () => {
    expect(parseFailures('✓ all good\nTests 12 passed')).toEqual([]);
  });
});

describe('compareRuns', () => {
  it('fails when a new test failure appears', () => {
    const report = compareRuns(run('× a 1ms', 1), run('× a 1ms\n× b 2ms', 1));
    expect(report.passed).toBe(false);
    expect(report.newFailures).toEqual(['b']);
  });

  it('passes when failures stay inside the baseline', () => {
    const report = compareRuns(run('× a 1ms\n× b 2ms', 1), run('× a 3ms', 1));
    expect(report.passed).toBe(true);
    expect(report.fixedFailures).toEqual(['b']);
  });

  it('passes on a fully green after-run', () => {
    const report = compareRuns(run('× a 1ms', 1), run('All 12 passed', 0));
    expect(report.passed).toBe(true);
    expect(report.fixedFailures).toEqual(['a']);
  });

  it('passes when both runs are green even with no parsed failures', () => {
    expect(compareRuns(run('ok', 0), run('ok', 0)).passed).toBe(true);
  });

  it('fails on a red after-run with unparseable output', () => {
    const report = compareRuns(run('ok', 0), run('SyntaxError: unexpected token', 1));
    expect(report.passed).toBe(false);
    expect(report.newFailures).toEqual([]);
  });

  it('is unaffected by timing differences between runs', () => {
    const report = compareRuns(run('× suite > test 111ms', 1), run('× suite > test 42ms', 1));
    expect(report.passed).toBe(true);
  });
});

describe('detectTestCommand', () => {
  it('returns null without a test script', () => {
    expect(detectTestCommand(dir)).toBeNull();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'x' } }));
    expect(detectTestCommand(dir)).toBeNull();
  });

  it('detects the script and the package manager', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    expect(detectTestCommand(dir)).toBe('bun run test');
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectTestCommand(dir)).toBe('npm run test');
  });
});

describe('runTestCommand', () => {
  it('captures output and exit code', () => {
    const result = runTestCommand("printf 'hello'; exit 3");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('hello');
  });
});
