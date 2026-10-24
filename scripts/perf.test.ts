import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Context } from '../packages/core/src/context/context.js';

const ROOT = join(import.meta.dirname, '..');
const BUN = basename(process.execPath).includes('bun') ? process.execPath : 'bun';
const run = promisify(execFile);

const FILE_COUNT = 300;
const INDEX_BUDGET_MS = 15_000;
const MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
const STARTUP_BUDGET_MS = 20_000;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lare-perf-'));
  const body = Array.from(
    { length: 40 },
    (_, line) =>
      `export function handler${line}(input: string) { return input.trim() + '${line}'; }`
  ).join('\n');
  for (let index = 0; index < FILE_COUNT; index += 1) {
    writeFileSync(join(root, `module-${index}.ts`), `// module ${index}\n${body}\n`);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('context performance budget', () => {
  it('indexes the fixture repository inside the time and memory budget', async () => {
    const context = new Context();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    await context.index(root);
    const elapsed = performance.now() - started;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;

    process.stdout.write(
      `context index: ${FILE_COUNT} files in ${elapsed.toFixed(0)}ms, heap +${Math.round(
        heapDelta / 1024 / 1024
      )}MB\n`
    );
    expect(context.size).toBe(FILE_COUNT);
    expect(elapsed).toBeLessThan(INDEX_BUDGET_MS);
    expect(heapDelta).toBeLessThan(MEMORY_BUDGET_BYTES);
  });
});

describe('startup performance budget', () => {
  it('starts the CLI and prints the version inside the budget', async () => {
    const started = performance.now();
    const { stdout } = await run(BUN, [join(ROOT, 'packages/cli/src/index.ts'), '--version']);
    const elapsed = performance.now() - started;
    process.stdout.write(`cli startup (--version): ${elapsed.toFixed(0)}ms\n`);
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(elapsed).toBeLessThan(STARTUP_BUDGET_MS);
  }, 60_000);
});
