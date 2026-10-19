import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCP } from './mcp.js';
import { mcpTools } from './tools.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Logger } from '../logger/logger.js';
import { Permissions, type PermissionPolicy } from '../permission/permission.js';

const FAKE_SERVER = `
const { stdin, stdout } = process;
let buffer = '';
function send(message) {
  stdout.write(JSON.stringify(message) + '\\n');
}
function handle(message) {
  if (message.id === undefined) return;
  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '0.1.0' },
        },
      });
      break;
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo text',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string', description: 'What to echo' } },
                required: ['text'],
              },
            },
          ],
        },
      });
      break;
    case 'tools/call':
      if (message.params.name === 'echo') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: 'echo: ' + message.params.arguments.text }] },
        });
      } else if (message.params.name === 'boom') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: 'boom failed' }], isError: true },
        });
      } else {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'tool blew up' } });
      }
      break;
    default:
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } });
  }
}
stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  for (;;) {
    const newline = buffer.indexOf('\\n');
    if (newline === -1) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});
`;

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

function toolContext(dir: string, policy?: PermissionPolicy): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: dir,
    permissions: new Permissions(policy),
    abortSignal: new AbortController().signal,
  };
}

function dispatch(message: Record<string, unknown>): Record<string, unknown> | null {
  const id = message.id;
  if (id === undefined) return null;
  switch (message.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-http', version: '0.1.0' },
        },
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo text',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string', description: 'What to echo' } },
                required: ['text'],
              },
            },
          ],
        },
      };
    case 'tools/call': {
      const params = message.params as { name: string; arguments: { text: string } };
      if (params.name === 'echo') {
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: 'http echo: ' + params.arguments.text }] },
        };
      }
      return { jsonrpc: '2.0', id, error: { code: -32000, message: 'tool blew up' } };
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
  }
}

describe('mcp client (stdio)', () => {
  let dir: string;
  let mcp: MCP;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lare-mcp-'));
    await writeFile(join(dir, 'server.cjs'), FAKE_SERVER);
    mcp = new MCP({ logger: quiet() });
    await mcp.connect({
      name: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [join(dir, 'server.cjs')],
    });
  });

  afterEach(async () => {
    await mcp.disconnect('fake');
    await rm(dir, { recursive: true, force: true });
  });

  it('connects, lists tools, and calls a tool', async () => {
    const tools = await mcp.listTools('fake');
    expect(tools.map((tool) => tool.name)).toEqual(['echo']);
    expect(tools[0]?.description).toBe('Echo text');
    const result = await mcp.callTool('fake', 'echo', { text: 'hi' });
    expect(result).toBe('echo: hi');
  });

  it('fails on tool results marked as errors', async () => {
    await expect(mcp.callTool('fake', 'boom', {})).rejects.toMatchObject({
      code: 'MCP_TOOL_FAILED',
      message: 'boom failed',
    });
  });

  it('fails on JSON-RPC error responses', async () => {
    await expect(mcp.callTool('fake', 'missing', {})).rejects.toMatchObject({
      code: 'MCP_TOOL_FAILED',
      message: expect.stringContaining('tool blew up'),
    });
  });

  it('rejects calls to unknown servers', async () => {
    await expect(mcp.callTool('ghost', 'echo', {})).rejects.toMatchObject({
      code: 'MCP_CONNECTION_FAILED',
    });
  });

  it('rejects configs without a command', async () => {
    await expect(mcp.connect({ name: 'bare', transport: 'stdio' })).rejects.toMatchObject({
      code: 'MCP_CONNECTION_FAILED',
    });
  });

  it('rejects when the server process cannot spawn', async () => {
    await expect(
      mcp.connect({ name: 'broken', transport: 'stdio', command: 'lare-missing-mcp-server-xyz' })
    ).rejects.toMatchObject({ code: 'MCP_CONNECTION_FAILED' });
  });
});

describe('mcp client (http)', () => {
  let server: Server;
  let url: string;
  let mcp: MCP;
  const requests: Array<{ method?: string; session?: string }> = [];

  beforeEach(async () => {
    requests.length = 0;
    server = createServer((request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end();
        return;
      }
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      request.on('end', () => {
        const message = JSON.parse(body) as Record<string, unknown>;
        requests.push({
          method: message.method as string | undefined,
          session: request.headers['mcp-session-id'] as string | undefined,
        });
        if (message.method === 'initialize') {
          response.setHeader('mcp-session-id', 'sess-1');
        }
        const reply = dispatch(message);
        if (!reply) {
          response.statusCode = 202;
          response.end();
          return;
        }
        if (message.method === 'tools/call') {
          response.setHeader('content-type', 'text/event-stream');
          response.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    url = `http://127.0.0.1:${port}/mcp`;
    mcp = new MCP({ logger: quiet() });
    await mcp.connect({ name: 'fake-http', transport: 'http', url });
  });

  afterEach(async () => {
    await mcp.disconnect('fake-http');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('lists and calls tools over streamable http', async () => {
    const tools = await mcp.listTools('fake-http');
    expect(tools.map((tool) => tool.name)).toEqual(['echo']);
    const result = await mcp.callTool('fake-http', 'echo', { text: 'hi' });
    expect(result).toBe('http echo: hi');
  });

  it('echoes the session id assigned during initialize', async () => {
    await mcp.listTools('fake-http');
    expect(requests[0]?.session).toBeUndefined();
    expect(requests.slice(1).every((entry) => entry.session === 'sess-1')).toBe(true);
  });

  it('fails on JSON-RPC error responses', async () => {
    await expect(mcp.callTool('fake-http', 'missing', {})).rejects.toMatchObject({
      code: 'MCP_TOOL_FAILED',
      message: expect.stringContaining('tool blew up'),
    });
  });
});

describe('mcp tools', () => {
  let dir: string;
  let mcp: MCP;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lare-mcp-tools-'));
    await writeFile(join(dir, 'server.cjs'), FAKE_SERVER);
    mcp = new MCP({ logger: quiet() });
    await mcp.connect({
      name: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [join(dir, 'server.cjs')],
    });
  });

  afterEach(async () => {
    await mcp.disconnect('fake');
    await rm(dir, { recursive: true, force: true });
  });

  it('exposes mcp tools with a namespaced name and coerced schema', async () => {
    const tools = new Tools({ logger: quiet() });
    for (const tool of await mcpTools(mcp, 'fake')) tools.register(tool);
    const registered = tools.get('mcp_fake_echo');
    expect(registered).toBeDefined();
    expect(registered?.schema).toEqual({
      type: 'object',
      properties: { text: { type: 'string', description: 'What to echo' } },
      required: ['text'],
    });
  });

  it('denies calls when external-services is not approved', async () => {
    const tools = new Tools({ logger: quiet() });
    for (const tool of await mcpTools(mcp, 'fake')) tools.register(tool);
    const result = await tools.execute(
      { id: 'c1', name: 'mcp_fake_echo', arguments: { text: 'hi' } },
      toolContext(dir)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('PERMISSION_DENIED');
  });

  it('runs the tool once external-services is allowed', async () => {
    const tools = new Tools({ logger: quiet() });
    for (const tool of await mcpTools(mcp, 'fake')) tools.register(tool);
    const result = await tools.execute(
      { id: 'c2', name: 'mcp_fake_echo', arguments: { text: 'hi' } },
      toolContext(dir, { mode: 'ask', allowedGroups: ['read', 'external-services'] })
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ text: 'echo: hi' });
  });
});
