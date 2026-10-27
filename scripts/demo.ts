import { execFileSync } from 'node:child_process';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const INTRO = 'Let me look at the repository first.';

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
  return execFileSync('tmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function capture(): string {
  return tmux(['capture-pane', '-p', '-t', SESSION]);
}

async function waitVisible(needle: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (capture().includes(needle)) return;
    } catch {
      // session not ready yet
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for "${needle}" in the pane`);
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
        res.write(sseEvent({ choices: [{ delta: { content: `${INTRO}\n\n` } }] }));
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

type CastEvent = [number, string, string];

function postProcess(): void {
  const lines = readFileSync(OUT, 'utf8').trim().split('\n');
  const header = lines[0];
  const events = lines.slice(1).map((line) => JSON.parse(line) as CastEvent);

  // cut the alt-screen teardown so the clip ends on the final answer frame
  const exitIndex = events.findIndex(
    ([, type, data]) => type === 'o' && data.includes('\x1b[?1049l')
  );
  if (exitIndex > 0) events.length = exitIndex;

  // the first turn indexes the workspace while the spinner keeps the stream
  // alive, so idle limiting cannot shorten it; squeeze that wait and pull the
  // rest of the session forward to match
  const typedIndex = events.findIndex((event) => event[1] === 'o' && event[2].includes(PROMPT));
  const introIndex = events.findIndex((event) => event[1] === 'o' && event[2].includes(INTRO));
  if (typedIndex >= 0 && introIndex > typedIndex) {
    const from = events[typedIndex][0];
    const span = events[introIndex][0] - from;
    const scale = Math.min(1, 2.5 / Math.max(0.001, span));
    if (scale < 1) {
      for (let index = typedIndex; index < introIndex; index += 1) {
        events[index][0] = Number((from + (events[index][0] - from) * scale).toFixed(6));
      }
      const shift = Number((span * scale - span).toFixed(6));
      for (let index = introIndex; index < events.length; index += 1) {
        events[index][0] = Number((events[index][0] + shift).toFixed(6));
      }
    }
  }

  // the permission hold is a deliberate on-camera beat, but the TUI renders
  // nothing while it waits, so agg's idle limit would cut it to one second;
  // re-emit the last panel event through the gap to keep the window alive
  const permissionIndex = events.findIndex(
    (event) => event[1] === 'o' && event[2].includes('permission: shell')
  );
  if (permissionIndex >= 0) {
    let last = permissionIndex;
    while (last + 1 < events.length && events[last + 1][0] - events[last][0] < 0.5) {
      last += 1;
    }
    if (last + 1 < events.length) {
      const start = events[last][0];
      // the deliberate hold is ~3s; a frozen tool run can stretch the quiet
      // window far beyond it, so only keep that beat alive and let agg's idle
      // limit compress whatever follows
      const end = Math.min(events[last + 1][0], start + 3.0);
      const injected: CastEvent[] = [];
      for (let t = start + 0.35; t < end - 0.15; t += 0.35) {
        injected.push([Number(t.toFixed(6)), 'o', events[last][2]]);
      }
      if (injected.length > 0) {
        events.splice(last + 1, 0, ...injected);
        console.log(`injected ${injected.length} hold events into ${(end - start).toFixed(1)}s`);
      }
    }
  }

  writeFileSync(OUT, `${header}\n${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  console.log(`wrote ${OUT} (${events.length} events, ${(events.at(-1)?.[0] ?? 0).toFixed(1)}s)`);
}

async function main(): Promise<void> {
  execFileSync('tmux', ['-V'], { stdio: 'ignore' });
  execFileSync('asciinema', ['--version'], { stdio: 'ignore' });
  // cold storage can need over a minute to page in the module graph; warm it
  // before the recording so the cast does not sit on a dead startup
  execFileSync(BUN, [join(ROOT, 'packages/cli/src/index.ts'), '--version'], { stdio: 'ignore' });
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
    `#!/bin/sh\nCI=false FORCE_COLOR=3 LARECODE_LOG_LEVEL=error LARECODE_HOME='${home}' '${BUN}' '${join(ROOT, 'packages/cli/src/index.ts')}' chat\n`,
    { mode: 0o755 }
  );

  rmSync(OUT, { force: true });
  tmux([
    'new-session',
    '-d',
    '-s',
    SESSION,
    '-x',
    String(COLS),
    '-y',
    String(ROWS),
    `asciinema rec -q -c "'${launcher}'" '${OUT}'`,
  ]);

  try {
    await waitVisible('Ask anything', 120_000);
    await delay(1200);
    tmux(['send-keys', '-l', '-t', SESSION, PROMPT]);
    await delay(600);
    tmux(['send-keys', '-t', SESSION, 'C-m']);
    await waitVisible(PERMISSION_NEEDLE, 120_000);
    await delay(2800);
    tmux(['send-keys', '-t', SESSION, 'y']);
    await waitVisible(LAST_MARKER, 120_000);
    await delay(2000);
    tmux(['send-keys', '-t', SESSION, 'C-c']);
    await delay(1500);
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

  postProcess();
  rmSync(home, { recursive: true, force: true });
}

void main().catch((error: unknown) => {
  console.error(`demo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
