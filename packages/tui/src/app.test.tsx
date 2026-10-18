import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

const ALLOWED_GLYPHS = /[●⎿❯»✓✗?~·]/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

describe('App', () => {
  it('renders the main screen chrome', () => {
    const { lastFrame } = render(<App model="test-model" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('❯');
    expect(frame).toContain('plan (Tab) · test-model');
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
    expect(frame).toContain('> hi');
    expect(frame).toContain('● lumps · plan');
    expect(frame).toContain('Hello world');
  });

  it('shows the slash palette, completes on tab, and runs notes', async () => {
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
    expect(lastFrame()).toContain('» enter send · ctrl+j newline');
  });

  it('toggles the agent on tab and clears on /clear', async () => {
    const { stdin, lastFrame } = render(<App />);
    await flush();
    stdin.write('\t');
    await flush();
    expect(lastFrame()).toContain('build (Tab)');

    stdin.write('hello');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).toContain('> hello');

    stdin.write('/clear');
    await flush();
    stdin.write('\r');
    await flush();
    expect(lastFrame()).not.toContain('> hello');
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

  it('matches the main screen snapshot', () => {
    const { lastFrame } = render(<App model="gpt-4o" />);
    expect(lastFrame()).toMatchSnapshot();
  });
});
