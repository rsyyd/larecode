export type ErrorCode =
  | 'UNKNOWN'
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_EXECUTION_FAILED'
  | 'PATCH_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CORRUPTED'
  | 'MEMORY_QUOTA_EXCEEDED'
  | 'CONTEXT_OVERFLOW'
  | 'MCP_CONNECTION_FAILED'
  | 'MCP_TOOL_FAILED'
  | 'LSP_UNAVAILABLE'
  | 'SKILL_LOAD_FAILED'
  | 'SKILL_EXECUTION_FAILED'
  | 'SKILL_WRITE_FAILED'
  | 'HOOK_EXECUTION_FAILED'
  | 'GIT_OPERATION_FAILED'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'CANCELLED';

export const ERROR_CATEGORIES: Record<
  ErrorCode,
  | 'user'
  | 'system'
  | 'provider'
  | 'tool'
  | 'permission'
  | 'session'
  | 'memory'
  | 'context'
  | 'mcp'
  | 'lsp'
  | 'skill'
  | 'hook'
  | 'network'
  | 'budget'
> = {
  UNKNOWN: 'system',
  CONFIG_INVALID: 'system',
  CONFIG_NOT_FOUND: 'system',
  PROVIDER_UNAVAILABLE: 'provider',
  PROVIDER_AUTH_FAILED: 'provider',
  MODEL_NOT_FOUND: 'provider',
  TOOL_NOT_FOUND: 'tool',
  TOOL_EXECUTION_FAILED: 'tool',
  PATCH_CONFLICT: 'tool',
  PERMISSION_DENIED: 'permission',
  SESSION_NOT_FOUND: 'session',
  SESSION_CORRUPTED: 'session',
  MEMORY_QUOTA_EXCEEDED: 'memory',
  CONTEXT_OVERFLOW: 'context',
  MCP_CONNECTION_FAILED: 'mcp',
  MCP_TOOL_FAILED: 'mcp',
  LSP_UNAVAILABLE: 'lsp',
  SKILL_LOAD_FAILED: 'skill',
  SKILL_EXECUTION_FAILED: 'skill',
  SKILL_WRITE_FAILED: 'skill',
  HOOK_EXECUTION_FAILED: 'hook',
  GIT_OPERATION_FAILED: 'tool',
  NETWORK_ERROR: 'network',
  RATE_LIMITED: 'provider',
  BUDGET_EXCEEDED: 'budget',
  CANCELLED: 'system',
};

export interface LumpsErrorJSON {
  name: string;
  code: ErrorCode;
  category: string;
  message: string;
  retryable: boolean;
  context: Record<string, unknown>;
  stack?: string;
  cause?: { name: string; message: string; stack?: string };
}

export class LumpsError extends Error {
  public readonly code: ErrorCode;
  public readonly category: string;
  public readonly retryable: boolean;
  public readonly context: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { cause?: Error; context?: Record<string, unknown>; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = 'LumpsError';
    this.code = code;
    this.category = ERROR_CATEGORIES[code];
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  static from(code: ErrorCode, message: string, context?: Record<string, unknown>): LumpsError {
    return new LumpsError(code, message, { context });
  }

  static wrap(code: ErrorCode, error: Error, context?: Record<string, unknown>): LumpsError {
    return new LumpsError(code, error.message, { cause: error, context, retryable: false });
  }

  toJSON(): LumpsErrorJSON {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack,
      cause:
        this.cause instanceof Error
          ? { name: this.cause.name, message: this.cause.message, stack: this.cause.stack }
          : undefined,
    };
  }
}

export function isLumpsError(err: unknown): err is LumpsError {
  return err instanceof LumpsError;
}

export function assertLumpsError(err: unknown): LumpsError {
  if (!isLumpsError(err)) {
    throw new LumpsError('UNKNOWN', 'Expected LumpsError', { context: { received: String(err) } });
  }
  return err;
}
