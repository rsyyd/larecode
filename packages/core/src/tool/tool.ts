import type { Permissions } from '../permission/permission.js';
import type { ToolSpec } from '../provider/provider.js';
import { LumpsError } from '../error/error.js';
import { defaultLogger, Logger } from '../logger/logger.js';

export type ToolSchema = {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
};

export interface Tool {
  name: string;
  description: string;
  schema: ToolSchema;
  execute(args: unknown, context: ToolContext): Promise<unknown>;
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
  private readonly tools = new Map<string, Tool>();
  private readonly logger: Logger;

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger ?? defaultLogger;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn('tool already registered, overwriting', { name: tool.name });
    }
    this.tools.set(tool.name, tool);
    this.logger.debug('tool registered', {
      name: tool.name,
      properties: Object.keys(tool.schema.properties),
    });
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  toToolSpecs(): ToolSpec[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    }));
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      this.logger.warn('tool call failed: not found', { id: call.id, name: call.name });
      return { id: call.id, success: false, error: `Tool not found: ${call.name}` };
    }

    if (context.abortSignal.aborted) {
      this.logger.warn('tool call aborted before execution', { id: call.id, name: call.name });
      return { id: call.id, success: false, error: 'cancelled' };
    }

    this.logger.info('calling tool', { id: call.id, name: call.name });
    const startedAt = Date.now();
    try {
      const output = await tool.execute(call.arguments, context);
      this.logger.info('tool complete', {
        id: call.id,
        name: call.name,
        latencyMs: Date.now() - startedAt,
      });
      return { id: call.id, success: true, output };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      this.logger.error(
        'tool failed',
        { id: call.id, name: call.name, latencyMs },
        error instanceof Error ? error : undefined
      );
      const message =
        error instanceof LumpsError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      return { id: call.id, success: false, error: message };
    }
  }
}
