import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '../packages/core/src/context/context.js';
import { Sessions } from '../packages/core/src/session/session.js';
import type { Session, SessionMessage } from '../packages/core/src/session/session.js';

const FILE_COUNT = 300;
const SEARCH_RUNS = 100;
const SESSION_RUNS = 50;

interface Timing {
  name: string;
  runs: number;
  totalMs: number;
  avgMs: number;
}

function timeIt(name: string, runs: number, op: () => unknown): Promise<Timing> {
  return (async () => {
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) await op();
    const totalMs = performance.now() - started;
    return { name, runs, totalMs, avgMs: totalMs / runs };
  })();
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'lare-bench-'));
  const body = Array.from(
    { length: 40 },
    (_, line) =>
      `export function handler${line}(input: string) { return input.trim() + '${line}'; }`
  ).join('\n');
  for (let index = 0; index < FILE_COUNT; index += 1) {
    writeFileSync(join(root, `module-${index}.ts`), `// module ${index}\n${body}\n`);
  }
  return root;
}

function sessionFixture(): Session {
  const now = new Date();
  const messages: SessionMessage[] = Array.from({ length: 100 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index} with some content to serialize`,
    timestamp: now,
  }));
  return {
    id: 'bench-session',
    metadata: {
      id: 'bench-session',
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
      tokenUsage: 12_345,
      cost: 0.42,
      title: 'bench session',
    },
    messages,
  };
}

async function main(): Promise<void> {
  const root = fixture();
  const context = new Context();
  const timings: Timing[] = [];

  timings.push(await timeIt('context index', 1, () => context.index(root)));

  for (const query of ['handler', 'return input', 'module 7']) void context.search({ query });
  timings.push(
    await timeIt(
      'context search',
      SEARCH_RUNS,
      () => void context.search({ query: 'handler input' })
    )
  );

  const sessionDir = mkdtempSync(join(tmpdir(), 'lare-bench-sessions-'));
  const sessions = new Sessions(sessionDir);
  const session = sessionFixture();
  timings.push(
    await timeIt('session save+get', SESSION_RUNS, () => {
      sessions.save(session);
      sessions.get(session.id);
    })
  );

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(timings, null, 2)}\n`);
  } else {
    process.stdout.write('larecode benchmark (numbers vary by machine)\n\n');
    for (const timing of timings) {
      process.stdout.write(
        `${timing.name.padEnd(18)} ${String(timing.runs).padStart(4)} runs  ${timing.avgMs
          .toFixed(2)
          .padStart(9)} ms avg\n`
      );
    }
  }

  rmSync(root, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
}

void main();
