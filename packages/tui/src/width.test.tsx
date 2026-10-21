import { EventEmitter } from 'node:events';
import { render } from 'ink';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';

class FakeStdout extends EventEmitter {
  columns: number;
  rows = 40;
  frames: string[] = [];

  constructor(columns: number) {
    super();
    this.columns = columns;
  }

  write(chunk: string | Uint8Array): boolean {
    this.frames.push(String(chunk));
    return true;
  }

  lastFrame(): string {
    return this.frames.at(-1) ?? '';
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private buffer: string[] = [];

  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}

  write(data: string): void {
    this.buffer.push(data);
    this.emit('readable');
  }

  read(): string | null {
    return this.buffer.shift() ?? null;
  }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

function visibleLines(frame: string): string[] {
  return frame.replace(ANSI, '').split('\n');
}

function widestLine(frame: string): number {
  return Math.max(...visibleLines(frame).map((line) => [...line].length));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

async function mount(columns: number, tree: ReactElement = <App provider="test" model="test" />) {
  const stdout = new FakeStdout(columns);
  const stdin = new FakeStdin();
  const app = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await tick();
  return { app, stdout, stdin };
}

describe('App layout widths', () => {
  for (const columns of [40, 60, 80]) {
    it(`fits every line in ${columns} columns without clearing the screen`, async () => {
      const { app, stdout } = await mount(columns);
      const output = stdout.frames.join('');

      expect(widestLine(stdout.lastFrame())).toBeLessThanOrEqual(columns);
      expect(output).not.toContain('\x1b[2J');
      app.unmount();
    });
  }

  it('wraps a long transcript inside 40 columns', async () => {
    const text =
      'This is a long assistant answer that must wrap cleanly inside a narrow terminal window without spilling over the edge.';
    const { app, stdout } = await mount(
      40,
      <App model="test" initialMessages={[{ role: 'agent', text }]} />
    );

    expect(widestLine(stdout.lastFrame())).toBeLessThanOrEqual(40);
    expect(visibleLines(stdout.lastFrame()).join('\n')).toContain('terminal');
    app.unmount();
  });

  it('keeps the slash palette inside 40 columns', async () => {
    const { app, stdout, stdin } = await mount(40);
    stdin.write('/');
    await tick();

    expect(stdout.lastFrame()).toContain('/help');
    expect(widestLine(stdout.lastFrame())).toBeLessThanOrEqual(40);
    app.unmount();
  });

  it('reflows after a terminal resize', async () => {
    const { app, stdout } = await mount(80);
    expect(widestLine(stdout.lastFrame())).toBeLessThanOrEqual(80);

    stdout.columns = 40;
    stdout.emit('resize');
    await tick();

    expect(widestLine(stdout.lastFrame())).toBeLessThanOrEqual(40);
    expect(stdout.frames.join('')).not.toContain('\x1b[2J');
    app.unmount();
  });
});
