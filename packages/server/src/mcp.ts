import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  Logger,
  Permissions,
  Tools,
  VERSION,
  assertPreAuthorizable,
  coreTools,
  toolPermissionGroup,
  type LogLevel,
  type PermissionGroup,
  type Tool,
} from '@larecode/core';

export const MCP_SERVER_NAME = 'larecode';

export interface McpServeOptions {
  name?: string;
  version?: string;
  cwd?: string;
  allow?: PermissionGroup[];
  tools?: Tool[];
}

export async function serveMcp(options: McpServeOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const policy = assertPreAuthorizable(options.allow ?? []);
  const permissions = new Permissions({
    mode: 'ask',
    allowedGroups: Array.from(new Set<PermissionGroup>(['read', ...policy])),
  });
  const tools = new Tools({ logger: stderrLogger() });
  for (const tool of options.tools ?? coreTools()) tools.register(tool);

  const server = new Server(
    { name: options.name ?? MCP_SERVER_NAME, version: options.version ?? VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const group = toolPermissionGroup(name);
    const decision = permissions.check(group, { source: `mcp:${name}` });
    if (!decision.allowed) {
      return {
        content: [{ type: 'text', text: `permission denied: ${decision.reason}` }],
        isError: true,
      };
    }
    const result = await tools.execute(
      { id: `mcp-${name}-${Date.now()}`, name, arguments: args ?? {} },
      {
        sessionId: 'mcp',
        workingDir: cwd,
        permissions,
        abortSignal: new AbortController().signal,
      }
    );
    if (!result.success) {
      return { content: [{ type: 'text', text: result.error ?? 'tool failed' }], isError: true };
    }
    return { content: [{ type: 'text', text: renderOutput(result.output) }] };
  });

  await server.connect(new StdioServerTransport());
}

function renderOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined) return '';
  return JSON.stringify(output, null, 2);
}

function stderrLogger(): Logger {
  const level = (process.env.LARECODE_LOG_LEVEL as LogLevel | undefined) ?? 'error';
  return new Logger({
    level,
    handlers: [
      (entry) =>
        process.stderr.write(
          `${new Date(entry.timestamp).toISOString()} ${entry.level.toUpperCase()} ${entry.message}\n`
        ),
    ],
  });
}
