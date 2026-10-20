import { randomUUID } from 'node:crypto';
import { loadEffectiveConfig } from '../config/config.js';
import { LareError } from '../error/error.js';
import { Permissions, type PermissionGroup } from '../permission/permission.js';
import { toolPermissionGroup } from '../permission/tool-groups.js';
import { Providers, providersFromConfig } from '../provider/provider.js';
import type {
  CompletionOptions,
  ProviderMessage,
  ProviderToolCall,
  ProviderUsage,
  ToolSpec,
} from '../provider/provider.js';
import { coreTools } from '../tool/core.js';
import { Tools, type Tool, type ToolCall } from '../tool/tool.js';
import {
  DEFAULT_MODEL_PRICING,
  createUsageRecorder,
  estimateCost,
  estimateTokens,
  type UsageAggregate,
  type UsageRecorder,
} from '../usage/usage.js';
import { BUILTIN_AGENTS } from './agents.js';

export type ChatAgentName = 'plan' | 'build';

export interface ChatPermissionRequest {
  tool: string;
  group: PermissionGroup;
  args: unknown;
}

export type ChatPermissionConfirm = (request: ChatPermissionRequest) => Promise<boolean>;

export interface ChatRunOptions {
  signal: AbortSignal;
  agent?: ChatAgentName;
  confirm?: ChatPermissionConfirm;
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_end'; name: string; ok: boolean; output: string };

export interface ChatSessionOptions {
  provider?: string;
  model?: string;
  workingDir?: string;
  providers?: Providers;
  tools?: Tools;
  permissions?: Permissions;
  agent?: ChatAgentName;
  sessionId?: string;
  maxIterations?: number;
  maxToolCalls?: number;
  tokenBudget?: number;
  durationBudget?: number;
  usageRecorder?: UsageRecorder;
}

const TOOL_OUTPUT_LIMIT = 16_000;

function renderOutput(output: unknown): string {
  const text =
    typeof output === 'string'
      ? output
      : output === undefined
        ? ''
        : (JSON.stringify(output, null, 2) ?? String(output));
  return text.length > TOOL_OUTPUT_LIMIT
    ? `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n… truncated`
    : text;
}

function renderTranscript(messages: ProviderMessage[]): string {
  return messages
    .slice(1)
    .map((message) => {
      if (message.role === 'tool') return `tool result: ${message.content}`;
      if (message.role === 'assistant') {
        const calls = message.toolCalls?.map((call) => call.name).join(', ');
        return `assistant: ${message.content}${calls ? `\n[called: ${calls}]` : ''}`;
      }
      return `${message.role}: ${message.content}`;
    })
    .join('\n\n');
}

function parseArguments(raw: string): { args: unknown; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { args: {} };
  try {
    return { args: JSON.parse(trimmed) };
  } catch {
    return { args: {}, error: 'invalid JSON arguments' };
  }
}

export class ChatSession {
  private provider: string;
  private model: string;
  private readonly workingDir: string;
  private readonly providers: Providers;
  private readonly tools: Tools;
  private readonly permissions: Permissions;
  private readonly sessionId: string;
  private readonly usage: UsageRecorder;
  private readonly maxIterations: number;
  private readonly maxToolCalls: number;
  private readonly tokenBudget: number;
  private readonly durationBudget: number;
  private readonly startedAt = Date.now();
  private agent: ChatAgentName;
  private messages: ProviderMessage[];
  private tokensUsed = 0;

  constructor(options: ChatSessionOptions = {}) {
    const cwd = options.workingDir ?? process.cwd();
    const config = loadEffectiveConfig(cwd);
    this.provider = options.provider ?? config.defaultProvider;
    this.model = options.model ?? config.defaultModel;
    this.workingDir = cwd;
    this.sessionId = options.sessionId ?? randomUUID();
    this.permissions = options.permissions ?? new Permissions(config.permissions);
    this.maxIterations = options.maxIterations ?? 40;
    this.maxToolCalls = options.maxToolCalls ?? 200;
    this.tokenBudget = options.tokenBudget ?? 200_000;
    this.durationBudget = options.durationBudget ?? 600_000;
    this.usage = options.usageRecorder ?? createUsageRecorder(this.sessionId);
    this.agent = options.agent ?? 'plan';

    if (options.providers) {
      this.providers = options.providers;
    } else {
      this.providers = new Providers();
      for (const adapter of providersFromConfig(config)) this.providers.register(adapter);
    }

    if (options.tools) {
      this.tools = options.tools;
    } else {
      this.tools = new Tools();
      for (const tool of coreTools()) this.tools.register(tool);
    }

    this.messages = [{ role: 'system', content: this.systemPrompt() }];
  }

  getProvider(): string {
    return this.provider;
  }

  getModel(): string {
    return this.model;
  }

  selectModel(provider: string, model: string): void {
    if (!this.providers.get(provider)) {
      throw new LareError('PROVIDER_UNAVAILABLE', `Provider "${provider}" is not available`);
    }
    this.provider = provider;
    this.model = model;
  }

  getUsage(): UsageAggregate {
    return this.usage.getAggregate();
  }

  getHistory(): ProviderMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  setAgent(agent: ChatAgentName): void {
    if (agent === this.agent) return;
    this.agent = agent;
    this.messages[0] = { role: 'system', content: this.systemPrompt() };
  }

  reset(): void {
    this.messages = [{ role: 'system', content: this.systemPrompt() }];
  }

  async *run(prompt: string, options: ChatRunOptions): AsyncGenerator<ChatEvent> {
    if (options.agent) this.setAgent(options.agent);
    this.messages.push({ role: 'user', content: prompt });

    let iterations = 0;
    let toolCalls = 0;

    while (true) {
      if (options.signal.aborted) throw this.cancelled();
      if (iterations >= this.maxIterations) return;
      if (this.tokensUsed >= this.tokenBudget) return;
      if (Date.now() - this.startedAt >= this.durationBudget) return;
      iterations += 1;

      const adapter = this.providers.get(this.provider);
      if (!adapter) {
        throw new LareError('PROVIDER_UNAVAILABLE', `Provider "${this.provider}" is not available`);
      }

      const specs = adapter.capabilities.tools ? this.toolSpecs() : [];
      let reported: ProviderUsage | undefined;
      const completion: CompletionOptions = {
        model: this.model,
        abortSignal: options.signal,
        ...(specs.length > 0 ? { tools: specs } : {}),
        onUsage: (usage) => {
          reported = usage;
        },
      };

      let text = '';
      let calls: ProviderToolCall[] = [];
      let streamedTokens = 0;

      try {
        if (adapter.streamChat) {
          for await (const event of adapter.streamChat(this.messages, completion)) {
            if (options.signal.aborted) throw this.cancelled();
            if (event.type === 'usage') {
              reported = event.usage;
              continue;
            }
            if (event.type === 'tool_calls') {
              calls = event.calls;
              continue;
            }
            streamedTokens += estimateTokens(event.text);
            if (this.tokensUsed + streamedTokens > this.tokenBudget) break;
            text += event.text;
            yield { type: 'text', text: event.text };
          }
        } else {
          const transcript = renderTranscript(this.messages);
          for await (const chunk of adapter.streamComplete(transcript, {
            ...completion,
            systemPrompt: this.messages[0]?.content,
            tools: undefined,
          })) {
            if (options.signal.aborted) throw this.cancelled();
            streamedTokens += estimateTokens(chunk);
            if (this.tokensUsed + streamedTokens > this.tokenBudget) break;
            text += chunk;
            yield { type: 'text', text: chunk };
          }
        }
      } catch (error) {
        if (options.signal.aborted) throw this.cancelled();
        throw error;
      }

      this.recordUsage(text, reported);
      const budgetHit = this.tokensUsed >= this.tokenBudget;
      this.messages.push({
        role: 'assistant',
        content: text,
        ...(calls.length > 0 && !budgetHit ? { toolCalls: calls } : {}),
      });

      if (calls.length === 0 || budgetHit) return;

      let exhausted = false;
      const resolved = new Set<string>();
      try {
        for (const call of calls) {
          if (options.signal.aborted) throw this.cancelled();
          if (toolCalls >= this.maxToolCalls) {
            exhausted = true;
            resolved.add(call.id);
            this.messages.push({
              role: 'tool',
              content: 'ERROR: tool call limit reached',
              toolCallId: call.id,
            });
            continue;
          }
          toolCalls += 1;

          const parsed = parseArguments(call.arguments);
          if (parsed.error) {
            resolved.add(call.id);
            this.messages.push({
              role: 'tool',
              content: `ERROR: ${parsed.error}`,
              toolCallId: call.id,
            });
            yield { type: 'tool_end', name: call.name, ok: false, output: parsed.error };
            continue;
          }

          yield { type: 'tool_start', name: call.name, args: parsed.args };
          const outcome = await this.executeTool(
            call,
            parsed.args,
            options.confirm,
            options.signal
          );
          resolved.add(call.id);
          yield { type: 'tool_end', name: call.name, ok: outcome.ok, output: outcome.content };
          this.messages.push({
            role: 'tool',
            content: outcome.content,
            toolCallId: call.id,
          });
        }
      } catch (error) {
        for (const call of calls) {
          if (resolved.has(call.id)) continue;
          this.messages.push({
            role: 'tool',
            content: 'ERROR: cancelled',
            toolCallId: call.id,
          });
        }
        throw error;
      }

      if (exhausted) return;
    }
  }

  private cancelled(): LareError {
    return new LareError('CANCELLED', 'chat session cancelled');
  }

  private systemPrompt(): string {
    return `${BUILTIN_AGENTS[this.agent].systemPrompt}\n\nWorking directory: ${this.workingDir}`;
  }

  private async executeTool(
    call: ProviderToolCall,
    args: unknown,
    confirm: ChatPermissionConfirm | undefined,
    signal: AbortSignal
  ): Promise<{ ok: boolean; content: string }> {
    const available = BUILTIN_AGENTS[this.agent].tools;
    if (!available.includes('*') && !available.includes(call.name)) {
      return {
        ok: false,
        content: `PERMISSION_DENIED: ${call.name} is not available to the ${this.agent} agent`,
      };
    }

    const group = toolPermissionGroup(call.name);
    let decision = this.permissions.check(group, { source: 'chat' });

    const askBeforeBash = BUILTIN_AGENTS[this.agent].askBeforeBash && call.name === 'bash';
    if (askBeforeBash && decision.allowed && confirm) {
      decision = {
        allowed: false,
        requiresConfirmation: true,
        reason: 'plan mode asks before running commands',
      };
    }

    if (!decision.allowed) {
      if (decision.requiresConfirmation && confirm) {
        const approved = await confirm({ tool: call.name, group, args });
        if (signal.aborted) throw this.cancelled();
        if (!approved) {
          return {
            ok: false,
            content: `PERMISSION_DENIED: ${decision.reason ?? group}`,
          };
        }
      } else {
        return {
          ok: false,
          content: `PERMISSION_DENIED: ${decision.reason ?? group}`,
        };
      }
    }

    const toolCall: ToolCall = { id: call.id, name: call.name, arguments: args };
    const result = await this.tools.execute(toolCall, {
      sessionId: this.sessionId,
      workingDir: this.workingDir,
      permissions: this.permissions,
      abortSignal: signal,
    });
    return result.success
      ? { ok: true, content: renderOutput(result.output) }
      : { ok: false, content: `ERROR: ${result.error ?? 'tool failed'}` };
  }

  private availableTools(): Tool[] {
    const allowed = BUILTIN_AGENTS[this.agent].tools;
    return allowed.includes('*')
      ? this.tools.list()
      : this.tools.list().filter((tool) => allowed.includes(tool.name));
  }

  private toolSpecs(): ToolSpec[] {
    return this.availableTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema as unknown as Record<string, unknown>,
    }));
  }

  private recordUsage(text: string, reported: ProviderUsage | undefined): void {
    const input =
      reported?.input ?? estimateTokens(this.messages.map((message) => message.content).join('\n'));
    const output = reported?.output ?? estimateTokens(text);
    const tokens = {
      input,
      output,
      total: input + output,
      ...(reported?.cacheRead ? { cacheRead: reported.cacheRead } : {}),
    };
    const cost = estimateCost(tokens, this.model, DEFAULT_MODEL_PRICING);
    this.usage.record(tokens, cost, this.model, this.provider);
    this.tokensUsed += tokens.total;
  }
}
