import { execFileSync } from 'node:child_process';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(import.meta.dirname, '..');
const BUN = basename(process.execPath).includes('bun') ? process.execPath : 'bun';
const OUT = join(ROOT, 'docs', 'assets', 'demo.cast');
const SESSION = `lare-demo-${process.pid}`;

const PROMPT = 'what can larecode do?';
const ANSWER_CHUNKS = [
  'Lare Code is a terminal coding agent that runs every tool call through a permission policy.\n\n',
  '- Works with any OpenAI-compatible provider\n',
  '- Reads, edits, and searches your files with git checkpoints\n',
  '- Skills, subagents, and MCP servers extend it\n',
  '- Everything runs locally, no telemetry\n\n',
  'Start with:\n\n',
  '```bash\n',
  'larecode setup\n',
  'larecode doctor\n',
  'larecode run "explain this repository"\n',
  '```\n\n',
  'Happy building.',
];
const LAST_MARKER = 'Happy building';

function tmux(args: string[]): string {
  return execFileSync('tmux', args, { encoding: 'utf8' });
}

function capture(): string {
  return tmux(['capture-pane', '-p', '-e', '-S', '-', '-t', SESSION]);
}

async function waitFor(
  needle: string,
  timeoutMs: number,
  record: (frame: string) => void
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const frame = capture();
      if (frame !== last) {
        record(frame);
        last = frame;
      }
    } catch {
      // session not ready yet
    }
    if (last.includes(needle)) return;
    await delay(150);
  }
  throw new Error(`timed out waiting for "${needle}" in the recording`);
}

function fakeProvider(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: HttpServer = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'demo-model' }] }));
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      void (async () => {
        for (const chunk of ANSWER_CHUNKS) {
          await delay(60);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('demo server did not bind');
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function main(): Promise<void> {
  execFileSync('tmux', ['-V'], { stdio: 'ignore' });
  const home = mkdtempSync(join(tmpdir(), 'lare-demo-'));
  const provider = await fakeProvider();
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      version: '0.0.0',
      defaultProvider: 'demo',
      defaultModel: 'demo-model',
      permissions: { mode: 'allow', allowedGroups: ['read'] },
      providers: {
        demo: { type: 'openai-compatible', baseUrl: provider.url, models: ['demo-model'] },
      },
      mcpServers: {},
    })
  );
  const launcher = join(home, 'launch.sh');
  writeFileSync(
    launcher,
    `#!/bin/sh\nCI=false LARECODE_HOME='${home}' '${BUN}' '${join(ROOT, 'packages/cli/src/index.ts')}' chat\n`,
    { mode: 0o755 }
  );

  const started = Date.now();
  const events: Array<[number, string, string]> = [];
  const record = (frame: string): void => {
    events.push([Number(((Date.now() - started) / 1000).toFixed(3)), 'o', `\x1b[H\x1b[2J${frame}`]);
  };
  const pace = (entries: Array<[number, string, string]>): Array<[number, string, string]> => {
    if (entries.length === 0) return entries;
    const paced: Array<[number, string, string]> = [];
    let time = 0.1;
    paced.push([time, entries[0][1], entries[0][2]]);
    for (let index = 1; index < entries.length; index += 1) {
      time += Math.min(entries[index][0] - entries[index - 1][0], 1.5);
      paced.push([Number(time.toFixed(3)), entries[index][1], entries[index][2]]);
    }
    return paced;
  };

  try {
    tmux(['new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24', `'${launcher}'`]);
    await waitFor('Ask anything', 30_000, record);
    await delay(1000);
    tmux(['send-keys', '-l', '-t', SESSION, PROMPT]);
    await delay(600);
    tmux(['send-keys', '-t', SESSION, 'C-m']);
    await waitFor(LAST_MARKER, 30_000, record);
    await delay(2000);
  } finally {
    try {
      tmux(['kill-session', '-t', SESSION]);
    } catch {
      // session already gone
    }
    await provider.close();
  }

  const header = JSON.stringify({
    version: 2,
    width: 80,
    height: 24,
    timestamp: Math.floor(Date.now() / 1000),
    env: { TERM: 'xterm-256color', SHELL: '/bin/sh' },
  });
  const paced = pace(events);
  const cast = `${header}\n${paced.map((event) => JSON.stringify(event)).join('\n')}\n`;
  mkdirSync(join(ROOT, 'docs', 'assets'), { recursive: true });
  writeFileSync(OUT, cast);
  console.log(
    `wrote ${OUT} (${paced.length} events, ${(cast.length / 1024).toFixed(1)} kB, ${(paced.at(-1)?.[0] ?? 0).toFixed(1)}s)`
  );
  rmSync(home, { recursive: true, force: true });
}

void main().catch((error: unknown) => {
  console.error(`demo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
