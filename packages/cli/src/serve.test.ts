import { describe, expect, it } from 'vitest';
import type { ServerOptions } from '@lumpscode/server';
import { serveCommand, type ServeDeps } from './commands/serve.js';

function harness(overrides: Partial<ServeDeps> = {}) {
  const out: string[] = [];
  const created: ServerOptions[] = [];
  let stopped = false;
  const deps: ServeDeps = {
    env: {},
    create: (options) => {
      created.push(options);
      return {
        url: `http://${options.host}:${options.port}`,
        start: async () => {},
        stop: async () => {
          stopped = true;
        },
      };
    },
    waitForShutdown: async () => {},
    write: (text) => out.push(text),
    ...overrides,
  };
  return {
    deps,
    out,
    created,
    get stopped() {
      return stopped;
    },
  };
}

describe('serve command', () => {
  it('starts with the provided token and stops on shutdown', async () => {
    const ui = harness();
    const code = await serveCommand({ port: '5000', token: 'abc' }, ui.deps);
    expect(code).toBe(0);
    expect(ui.created[0]).toEqual({ port: 5000, host: '127.0.0.1', token: 'abc' });
    expect(ui.out.join('')).toContain('lumpscode server listening on http://127.0.0.1:5000');
    expect(ui.out.join('')).not.toContain('bearer token:');
    expect(ui.stopped).toBe(true);
  });

  it('uses LUMPSCODE_SERVER_TOKEN when no flag is given', async () => {
    const ui = harness({ env: { LUMPSCODE_SERVER_TOKEN: 'env-token' } });
    expect(await serveCommand({}, ui.deps)).toBe(0);
    expect(ui.created[0]?.token).toBe('env-token');
    expect(ui.out.join('')).not.toContain('bearer token:');
  });

  it('generates and prints a token when none is configured', async () => {
    const ui = harness();
    expect(await serveCommand({}, ui.deps)).toBe(0);
    const token = ui.created[0]?.token ?? '';
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(ui.out.join('')).toContain(`bearer token: ${token}`);
  });

  it('rejects invalid ports', async () => {
    const ui = harness();
    expect(await serveCommand({ port: 'nope' }, ui.deps)).toBe(1);
    expect(await serveCommand({ port: '70000' }, ui.deps)).toBe(1);
    expect(ui.created).toHaveLength(0);
    expect(ui.out.join('')).toContain('invalid port');
  });

  it('reports start failures', async () => {
    const ui = harness({
      create: () => ({
        url: 'http://127.0.0.1:4096',
        start: async () => {
          throw new Error('EADDRINUSE');
        },
        stop: async () => {},
      }),
    });
    expect(await serveCommand({ port: '4096' }, ui.deps)).toBe(1);
    expect(ui.out.join('')).toContain('failed to start server: EADDRINUSE');
  });
});
