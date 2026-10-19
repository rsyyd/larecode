import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LareError, type ErrorCode } from '../error/error.js';
import { defaultLogger, type Logger } from '../logger/logger.js';

export interface MCPServerConfig {
  name: string;
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ponytail: literal client version, importing VERSION from the barrel would cycle
const CLIENT_INFO = { name: 'larecode', version: '0.0.0' };
const REQUEST_TIMEOUT_MS = 15_000;

function transportOf(config: MCPServerConfig): 'stdio' | 'http' {
  return config.transport ?? (config.url ? 'http' : 'stdio');
}

function wrapMcpError(
  code: ErrorCode,
  error: unknown,
  context: Record<string, unknown>
): LareError {
  if (error instanceof LareError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return LareError.wrap(code, cause, context);
}

function normalizeContent(content: unknown[] | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .map((item) => {
      if (item && typeof item === 'object' && 'type' in item) {
        const record = item as { type?: string; text?: string };
        if (record.type === 'text' && typeof record.text === 'string') return record.text;
      }
      return JSON.stringify(item);
    })
    .join('\n');
}

export class MCP {
  private servers = new Map<string, MCPServerConfig>();
  private clients = new Map<string, Client>();
  private readonly logger: Logger;

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger ?? defaultLogger;
  }

  list(): string[] {
    return Array.from(this.servers.keys());
  }

  config(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  async connect(config: MCPServerConfig): Promise<void> {
    await this.disconnect(config.name);
    this.servers.set(config.name, config);
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    try {
      await client.connect(this.createTransport(config));
    } catch (error) {
      await client.close().catch(() => {});
      throw wrapMcpError('MCP_CONNECTION_FAILED', error, { server: config.name });
    }
    this.clients.set(config.name, client);
    this.logger.info('mcp server connected', {
      server: config.name,
      transport: transportOf(config),
    });
  }

  async disconnect(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;
    this.clients.delete(name);
    await client.close().catch(() => {});
  }

  async listTools(server: string): Promise<MCPTool[]> {
    const client = await this.client(server);
    let result: Awaited<ReturnType<Client['listTools']>>;
    try {
      result = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
    } catch (error) {
      throw wrapMcpError('MCP_TOOL_FAILED', error, { server });
    }
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? {
        type: 'object',
        properties: {},
        required: [],
      }) as unknown as Record<string, unknown>,
    }));
  }

  async callTool(server: string, tool: string, args: unknown): Promise<string> {
    const client = await this.client(server);
    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await client.callTool(
        { name: tool, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { timeout: REQUEST_TIMEOUT_MS }
      );
    } catch (error) {
      throw wrapMcpError('MCP_TOOL_FAILED', error, { server, tool });
    }
    const text = normalizeContent(result.content as unknown[] | undefined);
    if (result.isError) {
      throw new LareError('MCP_TOOL_FAILED', text || `mcp tool ${tool} reported an error`, {
        context: { server, tool },
      });
    }
    return text;
  }

  private createTransport(
    config: MCPServerConfig
  ): StdioClientTransport | StreamableHTTPClientTransport {
    if (transportOf(config) === 'http') {
      if (!config.url) {
        throw new LareError('MCP_CONNECTION_FAILED', `server "${config.name}" has no url`);
      }
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    }
    if (!config.command) {
      throw new LareError('MCP_CONNECTION_FAILED', `server "${config.name}" has no command`);
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...(process.env as Record<string, string>), ...config.env },
    });
  }

  private async client(name: string): Promise<Client> {
    const existing = this.clients.get(name);
    if (existing) return existing;
    const config = this.servers.get(name);
    if (!config) {
      throw new LareError('MCP_CONNECTION_FAILED', `unknown mcp server: ${name}`);
    }
    await this.connect(config);
    return this.clients.get(name) as Client;
  }
}
