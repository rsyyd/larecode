import type { Permissions } from '../permission/permission.js';

export interface ToolSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

export interface Tool {
  name: string;
  description: string;
  schema: ToolSchema;
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResult {
  id: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface ToolContext {
  sessionId: string;
  workingDir: string;
  permissions: Permissions;
  abortSignal: AbortSignal;
}

export class Tools {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { id: call.id, success: false, error: `Tool not found: ${call.name}` };
    }
    try {
      const output = await tool.execute(call.arguments, context);
      return { id: call.id, success: true, output };
    } catch (error) {
      return { id: call.id, success: false, error: String(error) };
    }
  }
}
