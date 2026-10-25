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
const COLS = 100;
const ROWS = 30;

const PROMPT = 'summarize this repository';
const PERMISSION_NEEDLE = 'permission: shell';
const LAST_MARKER = 'rsyyd.github.io/larecode';

const INTRO = 'Let me look at the repository first.\n\n';
const ANSWER_CHUNKS = [
  'This is **Lare Code**, a coding agent that runs in your terminal\n',
  ' and asks before it acts.\n\n',
  '- `packages/core` holds the agent loop, the tools, and the permission engine\n',
  '- `packages/cli` and `packages/tui` provide the commands and the interface\n',
  '- local first: no telemetry, no accounts\n\n',
  'Every tool call passes the permission gate you just approved.\n\n',
  'Get started:\n\n',
  '```bash\n',
  'larecode setup\n',
  'larecode doctor\n',
  '```\n',
  'Docs: rsyyd.github.io/larecode\n',
];

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

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function fakeProvider(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: HttpServer = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'demo-model' }] }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const body = Buffer.concat(chunks).toString('utf8');
      if (body.includes('tool_call_id')) {
        // second round: the tool result is in, stream the summary
        void (async () => {
          for (const chunk of ANSWER_CHUNKS) {
            await delay(300);
            res.write(sseEvent({ choices: [{ delta: { content: chunk } }] }));
          }
          res.write('data: [DONE]\n\n');
          res.end();
        })();
        return;
      }
      // first round: say hello, then ask to run ls (shell group, so it prompts)
      void (async () => {
        await delay(60);
        res.write(sseEvent({ choices: [{ delta: { content: INTRO } }] }));
        await delay(500);
        res.write(
          sseEvent({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_ls',
                      function: { name: 'bash', arguments: '{"command":"ls"}' },
                    },
                  ],
                },
              },
            ],
          })
        );
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
      permissions: { mode: 'ask', allowedGroups: ['read'] },
      providers: {
        demo: { type: 'openai-compatible', baseUrl: provider.url, models: ['demo-model'] },
      },
      mcpServers: {},
    })
  );
  const launcher = join(home, 'launch.sh');
  writeFileSync(
    launcher,
    `#!/bin/sh\nCI=false FORCE_COLOR=3 LARECODE_HOME='${home}' '${BUN}' '${join(ROOT, 'packages/cli/src/index.ts')}' chat\n`,
    { mode: 0o755 }
  );

  const started = Date.now();
  const events: Array<[number, string, string]> = [];
  const record = (frame: string): void => {
    events.push([Number(((Date.now() - started) / 1000).toFixed(3)), 'o', `\x1b[H\x1b[2J${frame}`]);
  };
  // frames that differ only by the footer spinner glyph or by cursor escapes
  // carry no information; keep the first, every third, and the last of each
  // run so long waits stay short on camera
  const SPINNER_GLYPHS = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g;
  const stripAnsi = (text: string): string =>
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(SPINNER_GLYPHS, '·');
  const compressSpinnerRuns = (
    entries: Array<[number, string, string]>
  ): Array<[number, string, string]> => {
    const keep: boolean[] = entries.map(() => true);
    let start = 0;
    for (let i = 1; i <= entries.length; i += 1) {
      if (i === entries.length || stripAnsi(entries[i][2]) !== stripAnsi(entries[i - 1][2])) {
        if (i - start > 6) {
          for (let j = start + 1; j < i - 1; j += 1) keep[j] = (j - start) % 3 === 0;
        }
        start = i;
      }
    }
    return entries.filter((_, index) => keep[index]);
  };
  // wall-clock timing is not reproducible across machines, so the final cast
  // gets fixed per-frame holds driven by content, not by when frames arrived
  const PHASES: Array<{ enter: string; hold: number }> = [
    { enter: PROMPT, hold: 0.3 }, // submitted, spinner while it thinks
    { enter: INTRO.trim(), hold: 0.6 }, // tool panel and permission prompt
    { enter: '✓ bash', hold: 0.42 }, // summary streams in
  ];
  const storyboard = (
    entries: Array<[number, string, string]>
  ): Array<[number, string, string]> => {
    if (entries.length === 0) return entries;
    const firstVisible = entries.findIndex(([, , data]) => stripAnsi(data).trim().length > 0);
    const trimmed = firstVisible > 0 ? entries.slice(firstVisible) : entries;
    const paced: Array<[number, string, string]> = [];
    let time = 0.1;
    let phase = -1;
    for (let index = 0; index < trimmed.length; index += 1) {
      const entry = trimmed[index];
      paced.push([time, entry[1], entry[2]]);
      while (phase + 1 < PHASES.length && entry[2].includes(PHASES[phase + 1].enter)) phase += 1;
      if (index === trimmed.length - 1) break;
      const hold = entry[2].includes(PERMISSION_NEEDLE)
        ? 2.4 // the pane is static while the user decides, so hold it on camera
        : phase === -1
          ? 1.1
          : PHASES[phase].hold;
      time = Number((time + hold).toFixed(3));
    }
    const last = paced.at(-1);
    if (last) paced.push([Number((last[0] + 1.6).toFixed(3)), last[1], last[2]]);
    return paced;
  };

  try {
    tmux([
      'new-session',
      '-d',
      '-s',
      SESSION,
      '-x',
      String(COLS),
      '-y',
      String(ROWS),
      `'${launcher}'`,
    ]);
    await waitFor('Ask anything', 30_000, record);
    await delay(1000);
    tmux(['send-keys', '-l', '-t', SESSION, PROMPT]);
    await delay(600);
    tmux(['send-keys', '-t', SESSION, 'C-m']);
    await waitFor(PERMISSION_NEEDLE, 30_000, record);
    await delay(2800);
    tmux(['send-keys', '-t', SESSION, 'y']);
    await waitFor(LAST_MARKER, 30_000, record);
    await delay(2000);
  } catch (error) {
    try {
      console.error(`--- pane at failure ---\n${capture()}\n--- end pane ---`);
    } catch {
      // session already gone
    }
    throw error;
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
    width: COLS,
    height: ROWS,
    timestamp: Math.floor(Date.now() / 1000),
    env: { TERM: 'xterm-256color', SHELL: '/bin/sh' },
  });
  const paced = storyboard(compressSpinnerRuns(events));
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
