import { LareError } from '../error/error.js';
import type { ProviderMessage } from '../provider/provider.js';
import type { UsageAggregate } from '../usage/usage.js';
import {
  DefaultAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeAgentName,
  type AgentRuntimeOptions,
  type AgentRuntimePermissionConfirm,
  type AgentRuntimePermissionRequest,
  type AgentRuntimeTurnInput,
} from './runtime.js';

export type ChatAgentName = AgentRuntimeAgentName;

export type ChatPermissionRequest = AgentRuntimePermissionRequest;

export type ChatPermissionConfirm = AgentRuntimePermissionConfirm;

export type ChatRunOptions = Omit<AgentRuntimeTurnInput, 'prompt'>;

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_end'; name: string; ok: boolean; output: string };

export type ChatSessionOptions = AgentRuntimeOptions;

export class ChatSession {
  private readonly runtime: AgentRuntime;

  constructor(options: ChatSessionOptions = {}) {
    this.runtime = new DefaultAgentRuntime(options);
  }

  get sessionId(): string {
    return this.runtime.sessionId;
  }

  getProvider(): string {
    return this.runtime.getProvider();
  }

  getModel(): string {
    return this.runtime.getModel();
  }

  selectModel(provider: string, model: string): void {
    this.runtime.selectModel(provider, model);
  }

  getUsage(): UsageAggregate {
    return this.runtime.getUsage();
  }

  getHistory(): ProviderMessage[] {
    return this.runtime.getHistory();
  }

  setAgent(agent: ChatAgentName): void {
    this.runtime.setAgent(agent);
  }

  reset(): void {
    this.runtime.reset();
  }

  async *run(prompt: string, options: ChatRunOptions): AsyncGenerator<ChatEvent> {
    for await (const event of this.runtime.run({ prompt, ...options })) {
      if (event.type === 'text') {
        yield { type: 'text', text: event.text };
      } else if (event.type === 'tool_start') {
        yield { type: 'tool_start', name: event.name, args: event.args };
      } else if (event.type === 'tool_end') {
        yield { type: 'tool_end', name: event.name, ok: event.ok, output: event.output };
      } else if (event.type === 'halt') {
        if (event.reason === 'cancelled') {
          throw new LareError('CANCELLED', 'chat session cancelled');
        }
      } else if (event.type === 'error') {
        throw new LareError(event.error.code, event.error.message, {
          retryable: event.error.retryable,
          context: event.error.context,
        });
      }
    }
  }
}
