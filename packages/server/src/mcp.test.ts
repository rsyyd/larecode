import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger, MCP } from '@larecode/core';
import { serveMcp } from './mcp.js';

const CLI_INDEX = fileURLToPath(new URL('../../cli/src/index.ts', import.meta.url));
const TIMEOUT = 30_000;

let dir: string;

function quiet(): Logger {
  return new Logger({ level: 'error', handlers: [() => {}] });
}

async function connect(...extra: string[]): Promise<MCP> {
  const mcp = new MCP({ logger: quiet() });
  await mcp.connect({
    name: 'self',
    transport: 'stdio',
    command: 'bun',
    args: [CLI_INDEX, 'mcp', 'serve', '--cwd', dir, ...extra],
  });
  return mcp;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-mcp-serve-'));
  await writeFile(join(dir, 'hello.txt'), 'hello from mcp\n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('serveMcp', () => {
  it(
    'lists core tools and serves read calls, denying write by default',
    async () => {
      const mcp = await connect();
      try {
        const tools = await mcp.listTools('self');
        const names = tools.map((tool) => tool.name);
        expect(names).toContain('read');
        expect(names).toContain('glob');
        expect(names).toContain('bash');
        const read = tools.find((tool) => tool.name === 'read');
        expect(read?.inputSchema.properties).toHaveProperty('path');

        const text = await mcp.callTool('self', 'read', { path: 'hello.txt' });
        expect(text).toContain('hello from mcp');

        await expect(
          mcp.callTool('self', 'write', { path: 'nope.txt', content: 'nope' })
        ).rejects.toThrow(/permission denied/);
        await expect(readFile(join(dir, 'nope.txt'), 'utf8')).rejects.toThrow();
      } finally {
        await mcp.disconnect('self');
      }
    },
    TIMEOUT
  );

  it(
    'pre-authorizes extra groups with --allow',
    async () => {
      const mcp = await connect('--allow', 'write');
      try {
        const text = await mcp.callTool('self', 'write', {
          path: 'out.txt',
          content: 'from mcp server',
        });
        expect(text).toContain('"created": true');
        await expect(readFile(join(dir, 'out.txt'), 'utf8')).resolves.toBe('from mcp server');

        await expect(mcp.callTool('self', 'bash', { command: 'echo hi' })).rejects.toThrow(
          /permission denied/
        );
      } finally {
        await mcp.disconnect('self');
      }
    },
    TIMEOUT
  );

  it('refuses to pre-authorize destructive and secrets groups', async () => {
    await expect(serveMcp({ allow: ['destructive'] })).rejects.toThrow(/never pre-authorizable/);
    await expect(serveMcp({ allow: ['nope' as 'read'] })).rejects.toThrow(
      /unknown permission group/
    );
  });
});
