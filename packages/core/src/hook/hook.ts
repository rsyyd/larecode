import type { ToolCall, ToolResult } from '../tool/tool.js';
import { defaultLogger, Logger } from '../logger/logger.js';

export type HookType = 'pre-tool' | 'post-tool' | 'session-start' | 'session-end';

export interface HookContext {
  event: HookType;
  sessionId?: string;
  call?: ToolCall;
  result?: ToolResult;
  payload?: unknown;
}

export interface HookDecision {
  block?: boolean;
  reason?: string;
}

export interface Hook {
  type: HookType;
  name?: string;
  handler: (context: HookContext) => HookDecision | void | Promise<HookDecision | void>;
}

export class Hooks {
  private hooks = new Map<HookType, Hook[]>();
  private logger: Logger;

  constructor(options: { logger?: Logger } = {}) {
    this.logger = options.logger ?? defaultLogger;
  }

  register(hook: Hook): void {
    const list = this.hooks.get(hook.type) ?? [];
    list.push(hook);
    this.hooks.set(hook.type, list);
    this.logger.debug('hook registered', { type: hook.type, name: hook.name });
  }

  async emit(
    type: HookType,
    context: Omit<HookContext, 'event'> = {}
  ): Promise<HookDecision | null> {
    for (const hook of this.hooks.get(type) ?? []) {
      let decision: HookDecision | void;
      try {
        decision = await hook.handler({ event: type, ...context });
      } catch (error) {
        this.logger.error(
          'hook failed',
          { type, name: hook.name },
          error instanceof Error ? error : undefined
        );
        if (type === 'pre-tool') {
          return {
            block: true,
            reason: `hook error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
        continue;
      }
      if (decision?.block) {
        return {
          block: true,
          reason: decision.reason ?? `blocked by ${hook.name ?? `${type} hook`}`,
        };
      }
    }
    return null;
  }
}
