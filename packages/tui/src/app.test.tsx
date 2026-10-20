import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { UsageAggregate } from '@larecode/core';
import { App } from './app.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

const ALLOWED_GLYPHS = /[●⎿❯»✓✗?~·]/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

describe('App', () => {
  it('renders the main screen chrome', () => {
    const { lastFrame } = render(<App model="test-model" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ask anything');
    expect(frame).toContain('Plan · test-model');
  });

  it('streams agent chunks into the conversation', async () => {
    const runTurn = async (
      _prompt: string,
      onChunk: (chunk: string) => void,
      _signal: AbortSignal
    ): Promise<void> => {
      onChunk('Hello ');
      await flush();
      onChunk('world');
    };

    const { stdin, lastFrame } = render(<App runTurn={runTurn} model="m" />);
    await flush();
    stdin.write('hi');
    await flush();
    stdin.write('\r');
    await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('hi');
    expect(frame).toContain('▣');
    expect(frame).toContain('Hello world');
  });

  it('shows the slash palette, completes on tab, and opens help', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('/he');
    await flush();
    expect(lastFrame()).toContain('/help');

    stdin.write('\t');
    await flush();
    expect(lastFrame()).toContain('/help ');

    stdin.write('\r');
    await flush();
    expect(lastFrame()).toContain('esc close');
    expect(lastFrame()).toContain('ctrl+j');

    stdin.write('\x1b');
    await flush();
    expect(lastFrame()).not.toContain('esc close');
  });

  it('toggles the agent on tab and clears on /clear', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('\t');
    await flush();
    expect(lastFrame()).toContain('Build ·');

    stdin.write('hello');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).toContain('hello');

    stdin.write('/clear');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).not.toContain('hello');
  });

  it('passes the selected agent to runTurn', async () => {
    const agents: string[] = [];
    const runTurn = async (
      _prompt: string,
      _onChunk: (chunk: string) => void,
      _signal: AbortSignal,
      agent: 'plan' | 'build'
    ): Promise<void> => {
      agents.push(agent);
    };

    const { stdin } = render(<App runTurn={runTurn} />);
    await flush();
    stdin.write('one');
    await flush();
    stdin.write('\r');
    await flush();
    stdin.write('\t');
    await flush();
    stdin.write('two');
    await flush();
    stdin.write('\r');
    await flush();
    expect(agents).toEqual(['plan', 'build']);
  });

  it('routes @general to the subagent seam', async () => {
    const calls: string[] = [];
    const runTurn = async (prompt: string, onChunk: (chunk: string) => void): Promise<void> => {
      calls.push(`turn:${prompt}`);
      onChunk('main result');
    };
    const runSubagentTurn = async (
      prompt: string,
      onChunk: (chunk: string) => void
    ): Promise<void> => {
      calls.push(`sub:${prompt}`);
      onChunk('sub result');
    };

    const { stdin, lastFrame } = render(
      <App runTurn={runTurn} runSubagentTurn={runSubagentTurn} />
    );
    await flush();
    stdin.write('@general find the parser');
    await flush();
    stdin.write('\r');
    await flush();
    expect(calls).toEqual(['sub:find the parser']);
    expect(lastFrame()).toContain('sub result');
  });

  it('aborts a running turn on escape', async () => {
    let aborted = false;
    const runTurn = (
      _prompt: string,
      _onChunk: (chunk: string) => void,
      signal: AbortSignal
    ): Promise<void> =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        });
      });

    const { stdin, lastFrame } = render(<App runTurn={runTurn} />);
    await flush();
    stdin.write('slow');
    await flush();
    stdin.write('\r');
    await flush();
    stdin.write('\x1b');
    await flush();
    expect(aborted).toBe(true);
    expect(lastFrame()).toContain('» interrupted');
  });

  it('renders emoji-free chrome', async () => {
    const { stdin, lastFrame } = render(<App model="m" />);
    await flush();
    stdin.write('/');
    await flush();
    const stripped = (lastFrame() ?? '').replace(ALLOWED_GLYPHS, '');
    expect(EMOJI.test(stripped)).toBe(false);
  });

  it('renders the first frame within 100 ms', () => {
    const started = performance.now();
    render(<App model="m" />);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('keeps rapid keystrokes without dropping any', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('a');
    stdin.write('b');
    stdin.write('c');
    await flush();
    expect(lastFrame()).toContain('abc');
  });

  it('moves the cursor with home and end', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('abc');
    await flush();
    stdin.write('\x1b[H');
    await flush();
    stdin.write('X');
    await flush();
    expect(lastFrame()).toContain('Xabc');
    stdin.write('\x1b[F');
    await flush();
    stdin.write('Y');
    await flush();
    expect(lastFrame()).toContain('XabcY');
  });

  it('deletes with terminal backspace (DEL)', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('abcde');
    await flush();
    expect(lastFrame()).toContain('abcde');
    stdin.write('\x7f');
    await flush();
    expect(lastFrame()).toContain('abcd');
    expect(lastFrame()).not.toContain('abcde');
  });

  it('deletes forward with the delete key', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('abc');
    await flush();
    stdin.write('\x1b[D');
    await flush();
    stdin.write('\x1b[D');
    await flush();
    stdin.write('\x1b[3~');
    await flush();
    expect(lastFrame()).toContain('ac');
    expect(lastFrame()).not.toContain('abc');
  });

  it('centers the slash palette above the prompt', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('/');
    await flush();
    const lines = (lastFrame() ?? '').split('\n');
    const help = lines.findIndex((line) => line.includes('/help'));
    expect(help).toBeGreaterThanOrEqual(0);
    expect(lines[help - 1]).toContain('commands');
    const line = lines[help] ?? '';
    expect(line.length - line.trimStart().length).toBeGreaterThan(10);
  });

  it('matches the main screen snapshot', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/home/user/app');
    const home = process.env.HOME;
    process.env.HOME = '/home/user';
    try {
      const { lastFrame } = render(<App model="gpt-4o" />);
      expect(lastFrame()).toMatchSnapshot();
    } finally {
      cwd.mockRestore();
      process.env.HOME = home;
    }
  });

  it('shows per-conversation tokens and cost in the footer after a turn', async () => {
    const runTurn = async (
      _prompt: string,
      onChunk: (chunk: string) => void,
      _signal: AbortSignal
    ): Promise<void> => {
      onChunk('done');
    };
    const usage: UsageAggregate = {
      totalTokens: { input: 900, output: 300, total: 1200, cacheRead: 400 },
      totalCost: { inputCost: 0.004, outputCost: 0.002, totalCost: 0.006 },
      byModel: {},
      conversationId: 'conv-tui',
      startedAt: 0,
      updatedAt: 0,
    };
    const { stdin, lastFrame } = render(
      <App runTurn={runTurn} model="gpt-4o" getUsage={() => usage} />
    );
    await flush();
    stdin.write('hi');
    await flush();
    stdin.write('\r');
    await flush();
    await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1.2k tok');
    expect(frame).toContain('$0.0060');
  });
  it('lists providers and switches provider and model on /model', async () => {
    const onSelectModel = vi.fn();
    const catalogs = [
      { provider: '9router', models: ['Combo', 'Gpt'] },
      { provider: 'ollama', models: ['qwen2.5-coder'] },
    ];
    const { stdin, lastFrame } = render(
      <App provider="9router" model="Gacor" catalogs={catalogs} onSelectModel={onSelectModel} />
    );
    await flush();
    stdin.write('/model');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).toContain('models · 1/3');
    expect(lastFrame()).toContain('9router/Combo');
    expect(lastFrame()).toContain('ollama/qwen2.5-coder');

    stdin.write('\x1b[B');
    await flush();
    stdin.write('\r');
    await flush();
    expect(onSelectModel).toHaveBeenCalledWith('9router', 'Gpt');
    expect(lastFrame()).toContain('Plan · Gpt');

    stdin.write('/model 9router Combo');
    await flush();
    stdin.write('\r');
    await flush();
    expect(onSelectModel).toHaveBeenCalledWith('9router', 'Combo');
    expect(lastFrame()).toContain('model → 9router/Combo');
    expect(lastFrame()).toContain('Plan · Combo');
  });

  it('reports an unknown provider when switching models', async () => {
    const onSelectModel = vi.fn(() => {
      throw new Error('Provider "nope" is not available');
    });
    const { stdin, lastFrame } = render(
      <App provider="9router" model="Combo" onSelectModel={onSelectModel} />
    );
    await flush();
    stdin.write('/model nope Gpt');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).toContain('Provider "nope" is not available');
  });
});

describe('App permissions', () => {
  it('shows a permission prompt and resumes when approved', async () => {
    const runTurn = async (
      _prompt: string,
      onChunk: (chunk: string) => void,
      _signal: AbortSignal,
      _agent: 'plan' | 'build',
      confirm?: (request: { tool: string; group: string; detail?: string }) => Promise<boolean>
    ): Promise<void> => {
      const allowed =
        (await confirm?.({ tool: 'bash', group: 'shell', detail: 'echo hello' })) ?? false;
      onChunk(allowed ? 'approved' : 'denied');
    };

    const { stdin, lastFrame } = render(<App runTurn={runTurn} />);
    await flush();
    stdin.write('hi');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).toContain('permission: shell · bash · y/n');
    expect(lastFrame()).toContain('echo hello');

    stdin.write('y');
    await flush();
    expect(lastFrame()).toContain('approved');
  });

  it('clears the host session on /clear', async () => {
    const onClear = vi.fn();
    const { stdin } = render(<App onClear={onClear} />);
    await flush();
    stdin.write('/clear');
    await flush();
    stdin.write('\r');
    await flush();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
