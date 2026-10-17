export type HookType = 'pre-tool' | 'post-tool' | 'session-start' | 'session-end';

export interface HookContext {
  event: HookType;
  payload?: unknown;
}

export interface Hook {
  type: HookType;
  handler: (ctx: HookContext) => void | Promise<void>;
}

export class HookManager {
  private hooks = new Map<HookType, Hook[]>();

  register(hook: Hook): void {
    const list = this.hooks.get(hook.type) ?? [];
    list.push(hook);
    this.hooks.set(hook.type, list);
  }

  async emit(type: HookType, payload?: unknown): Promise<void> {
    for (const hook of this.hooks.get(type) ?? []) {
      await hook.handler({ event: type, payload });
    }
  }
}
