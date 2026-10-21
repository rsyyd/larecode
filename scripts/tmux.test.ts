import { execFileSync } from 'node:child_process';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const BUN = process.env.BUN ?? 'bun';

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const enabled = process.env.LARECODE_TMUX === '1' && tmuxAvailable();
const smoke = enabled ? it : it.skip;

function tmux(args: string[]): string {
  return execFileSync('tmux', args, { encoding: 'utf8' });
}

async function waitFor(read: () => string, needle: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      last = read();
    } catch {
      last = '';
    }
    if (last.includes(needle)) return last;
    await delay(150);
  }
  throw new Error(`timed out waiting for "${needle}"\n--- screen ---\n${last}`);
}

describe('tmux smoke test', () => {
  smoke(
    'starts the TUI, streams a turn, and survives a resize',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'lare-tmux-'));
      const name = `lare-smoke-${process.pid}`;
      const requests: string[] = [];
      const http: HttpServer = createServer((req, res) => {
        requests.push(`${req.method ?? 'GET'} ${req.url ?? ''}`);
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
          return;
        }
        req.resume();
        req.on('end', () => {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
          });
          res.write('data: {"choices":[{"delta":{"content":"tmux-ok"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        });
      });
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('mock server did not bind');
      await mkdir(home, { recursive: true });
      await writeFile(
        join(home, 'config.json'),
        JSON.stringify({
          version: '0.0.0',
          defaultProvider: 'mock',
          defaultModel: 'mock-1',
          permissions: { mode: 'allow', allowedGroups: ['read'] },
          providers: {
            mock: {
              type: 'openai-compatible',
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              models: ['mock-1'],
            },
          },
          mcpServers: {},
        })
      );

      const capture = () => tmux(['capture-pane', '-p', '-t', name]);
      try {
        tmux([
          'new-session',
          '-d',
          '-s',
          name,
          '-x',
          '80',
          '-y',
          '24',
          `LARECODE_HOME=${home} ${BUN} ${join(ROOT, 'packages/cli/src/index.ts')} chat`,
        ]);
        await waitFor(capture, 'Ask anything', 20_000);
        tmux(['send-keys', '-l', '-t', name, 'hello from tmux']);
        tmux(['send-keys', '-t', name, 'C-m']);
        await waitFor(capture, 'tmux-ok', 20_000);

        tmux(['resize-window', '-t', name, '-x', '40', '-y', '24']);
        await delay(500);
        const resized = capture();
        expect(resized).toContain('tmux-ok');

        expect(requests.some((request) => request.includes('/chat/completions'))).toBe(true);
      } finally {
        try {
          tmux(['kill-session', '-t', name]);
        } catch {
          // session already gone
        }
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await rm(home, { recursive: true, force: true });
      }
    },
    45_000
  );
});
