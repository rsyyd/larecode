import { LumpsError } from '../error/error.js';
import type { Tool, ToolSchema } from '../tool/tool.js';
import type { MCP, MCPTool } from './mcp.js';

function toToolSchema(schema: Record<string, unknown>): ToolSchema {
  const properties: ToolSchema['properties'] = {};
  const raw = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  for (const [key, value] of Object.entries(raw)) {
    properties[key] = {
      type: value?.type ?? 'string',
      description: value?.description ?? '',
    };
  }
  return {
    type: 'object',
    properties,
    required: Array.isArray(schema.required) ? (schema.required as string[]) : [],
  };
}

function toTool(server: string, mcp: MCP, tool: MCPTool): Tool {
  return {
    name: `mcp_${server}_${tool.name}`,
    description: tool.description || `MCP tool "${tool.name}" from server "${server}"`,
    schema: toToolSchema(tool.inputSchema),
    async execute(args, context) {
      const decision = context.permissions.check('external-services', {
        source: `mcp:${server}/${tool.name}`,
      });
      if (!decision.allowed) {
        throw new LumpsError(
          'PERMISSION_DENIED',
          decision.reason ?? `mcp call to ${server}/${tool.name} requires approval`,
          { context: { server, tool: tool.name } }
        );
      }
      return { text: await mcp.callTool(server, tool.name, args) };
    },
  };
}

export async function mcpTools(mcp: MCP, server: string): Promise<Tool[]> {
  const tools = await mcp.listTools(server);
  return tools.map((tool) => toTool(server, mcp, tool));
}
