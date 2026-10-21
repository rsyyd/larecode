import { randomUUID } from 'node:crypto';
import { loadEffectiveConfig, type FallbackTarget } from '../config/config.js';
import { backendFromConfig } from '../exec/backend.js';
import { compactProviderMessages } from '../context/compact.js';
import { CONTEXT_HEADER, ContextBuilder, type ContextReport } from '../context/inject.js';
import { LSP } from '../lsp/lsp.js';
import { Skills } from '../skill/skill.js';
import { LareError } from '../error/error.js';
import type { LareErrorJSON } from '../error/error.js';
import { defaultLogger } from '../logger/logger.js';
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
import { Tools, validateToolArguments, type Tool, type ToolCall } from '../tool/tool.js';
import {
  DEFAULT_MODEL_PRICING,
  applyTokenRatio,
  createUsageRecorder,
  estimateCost,
  estimateTokens,
  tokenRatio,
  type UsageAggregate,
  type UsageRecorder,
} from '../usage/usage.js';
import { BUILTIN_AGENTS } from './agents.js';
import { AgentRuntimeLoop } from './runtime-loop.js';
import { Subagents } from './subagent.js';

export type AgentRuntimeAgentName = 'plan' | 'build' | 'general';

export interface AgentRuntimePermissionRequest {
  tool: string;
  group: PermissionGroup;
  args: unknown;
}

export type AgentRuntimePermissionConfirm = (
  request: AgentRuntimePermissionRequest
) => Promise<boolean>;

export interface AgentRuntimeTurnInput {
  prompt: string;
  signal: AbortSignal;
  agent?: AgentRuntimeAgentName;
  confirm?: AgentRuntimePermissionConfirm;
}

export type AgentRuntimeHaltReason =
  'completed' | 'iterations' | 'tool_calls' | 'budget' | 'duration' | 'cancelled' | 'error';

export type AgentRuntimeStopEvent =
  { type: 'halt'; reason: AgentRuntimeHaltReason } | { type: 'error'; error: LareErrorJSON };

export type AgentRuntimeEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; callId: string; name: string; args: unknown }
  | { type: 'tool_end'; callId: string; name: string; ok: boolean; output: string }
  | { type: 'usage'; usage: UsageAggregate }
  | {
      type: 'fallback';
      from: string;
      provider: string;
      model: string;
      reason: string;
    }
  | AgentRuntimeStopEvent;

export function isAgentRuntimeStopEvent(event: AgentRuntimeEvent): event is AgentRuntimeStopEvent {
  return event.type === 'halt' || event.type === 'error';
}

export interface AgentCheckpointSink {
  create(label?: string): Promise<unknown>;
}

export interface AgentRuntimeOptions {
  provider?: string;
  model?: string;
  workingDir?: string;
  providers?: Providers;
  tools?: Tools;
  extraTools?: Tool[];
  permissions?: Permissions;
  checkpoints?: AgentCheckpointSink;
  unattended?: boolean;
  agent?: AgentRuntimeAgentName;
  sessionId?: string;
  history?: ProviderMessage[];
  maxIterations?: number;
  maxToolCalls?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  tokenBudget?: number;
  durationBudget?: number;
  compactAtTokens?: number;
  compactKeepRecent?: number;
  context?: boolean;
  usageRecorder?: UsageRecorder;
  fallbacks?: FallbackTarget[];
}

export interface AgentRuntime {
  readonly sessionId: string;
  getProvider(): string;
  getModel(): string;
  getUsage(): UsageAggregate;
  getHistory(): ProviderMessage[];
  getContextReport(): ContextReport;
  setAgent(agent: AgentRuntimeAgentName): void;
  selectModel(provider: string, model: string): void;
  loadHistory(history: ProviderMessage[]): void;
  reset(): void;
  run(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>;
}

export function createSubagents(options: {
  providers: Providers;
  permissions: Permissions;
  workingDir: string;
}): Subagents {
  return new Subagents({
    providers: options.providers,
    createLoop: (run) =>
      new AgentRuntimeLoop({
        provider: run.provider,
        model: run.model,
        workingDir: options.workingDir,
        providers: options.providers,
        permissions: options.permissions,
        agent: 'general',
        abortSignal: run.signal,
        maxIterations: run.maxIterations,
        maxToolCalls: (run.maxIterations ?? 12) * 4,
        tokenBudget: run.tokenBudget,
        durationBudget: run.durationBudget,
      }),
  });
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

function isRetryable(error: unknown): boolean {
  return (
    error instanceof LareError &&
    (error.retryable || error.code === 'NETWORK_ERROR' || error.code === 'RATE_LIMITED')
  );
}

interface RequestDeadline {
  signal: AbortSignal;
  timedOut: () => boolean;
  cancel: () => void;
}

function createDeadline(timeoutMs: number, parent: AbortSignal): RequestDeadline {
  if (timeoutMs <= 0) {
    return { signal: parent, timedOut: () => false, cancel: () => {} };
  }
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parent.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('request timed out'));
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  parent.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cancel: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new LareError('CANCELLED', 'agent runtime cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new LareError('CANCELLED', 'agent runtime cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
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

export class DefaultAgentRuntime implements AgentRuntime {
  readonly sessionId: string;
  private provider: string;
  private model: string;
  private readonly workingDir: string;
  private readonly providers: Providers;
  private readonly tools: Tools;
  private readonly permissions: Permissions;
  private readonly checkpoints?: AgentCheckpointSink;
  private readonly unattended: boolean;
  private readonly usage: UsageRecorder;
  private readonly maxIterations: number;
  private readonly maxToolCalls: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly tokenBudget: number;
  private readonly durationBudget: number;
  private readonly compactAtTokens: number;
  private readonly compactKeepRecent: number;
  private readonly contextBuilder: ContextBuilder;
  private readonly fallbacks: FallbackTarget[];
  private fallbackCursor = 0;
  private startedAt = Date.now();
  private agent: AgentRuntimeAgentName;
  private messages: ProviderMessage[];
  private tokensUsed = 0;
  private tokenRatioValue = 1;

  constructor(options: AgentRuntimeOptions = {}) {
    const cwd = options.workingDir ?? process.cwd();
    const config = loadEffectiveConfig(cwd);
    this.provider = options.provider ?? config.defaultProvider;
    this.model = options.model ?? config.defaultModel;
    this.workingDir = cwd;
    this.sessionId = options.sessionId ?? randomUUID();
    this.permissions = options.permissions ?? new Permissions(config.permissions);
    this.checkpoints = options.checkpoints;
    this.unattended = options.unattended ?? false;
    this.maxIterations = options.maxIterations ?? 40;
    this.maxToolCalls = options.maxToolCalls ?? 200;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.tokenBudget = options.tokenBudget ?? 200_000;
    this.durationBudget = options.durationBudget ?? 600_000;
    this.compactAtTokens = options.compactAtTokens ?? 96_000;
    this.compactKeepRecent = options.compactKeepRecent ?? 6;
    this.contextBuilder = ContextBuilder.fromConfig(cwd, config, options.context);
    this.fallbacks = options.fallbacks ?? config.fallbacks ?? [];
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
      for (const tool of [...this.defaultTools(config), ...(options.extraTools ?? [])]) {
        this.tools.register(tool);
      }
    }

    this.messages = [
      { role: 'system', content: this.systemPrompt() },
      ...(options.history ?? [])
        .filter((message) => message.role !== 'system')
        .map((message) => ({ ...message })),
    ];
  }

  private async compactHistory(signal: AbortSignal): Promise<void> {
    const adapter = this.providers.get(this.provider);
    if (!adapter) return;
    try {
      const result = await compactProviderMessages(this.messages, {
        maxTokens: this.compactAtTokens,
        keepRecent: this.compactKeepRecent,
        summarize: (transcript) =>
          adapter.complete(transcript, {
            model: this.model,
            systemPrompt:
              'Summarize the conversation for future context. Preserve decisions, files, and open tasks.',
            abortSignal: signal,
            timeoutMs: this.requestTimeoutMs,
          }),
      });
      if (result.compacted) {
        this.messages = result.messages;
        defaultLogger.info('context compacted', {
          before: result.tokensBefore,
          after: result.tokensAfter,
        });
      }
    } catch (error) {
      defaultLogger.warn('context compaction failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private defaultTools(config: ReturnType<typeof loadEffectiveConfig>): Tool[] {
    const skills = new Skills({ projectDir: this.workingDir });
    skills.refresh();
    return coreTools({
      backend: backendFromConfig(config),
      lsp: new LSP({ rootDir: this.workingDir }),
      skills,
      subagents: createSubagents({
        providers: this.providers,
        permissions: this.permissions,
        workingDir: this.workingDir,
      }),
      agent: { provider: this.provider, model: this.model },
      webSearch: config.webSearch,
    });
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

  getContextReport(): ContextReport {
    return this.contextBuilder.report();
  }

  private switchToFallback(
    reason: unknown
  ): { from: string; provider: string; model: string } | undefined {
    if (this.fallbackCursor >= this.fallbacks.length) return undefined;
    if (reason instanceof LareError && reason.code === 'CANCELLED') return undefined;
    const from = this.provider;
    const seen = new Set<string>();
    while (this.fallbackCursor < this.fallbacks.length) {
      const target = this.fallbacks[this.fallbackCursor];
      this.fallbackCursor += 1;
      const key = `${target.provider}${target.model ? `:${target.model}` : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (target.provider === from && (target.model === undefined || target.model === this.model)) {
        continue;
      }
      if (!this.providers.get(target.provider)) continue;
      const model = target.model ?? this.model;
      this.provider = target.provider;
      this.model = model;
      defaultLogger.warn('provider fallback', { from, provider: target.provider, model, reason });
      return { from, provider: target.provider, model };
    }
    return undefined;
  }

  private *fallbackNotice(
    switched: { from: string; provider: string; model: string } | undefined,
    reason: string
  ): Generator<AgentRuntimeEvent, void, unknown> {
    if (switched) {
      yield {
        type: 'fallback',
        from: switched.from,
        provider: switched.provider,
        model: switched.model,
        reason,
      };
    }
  }

  setAgent(agent: AgentRuntimeAgentName): void {
    if (agent === this.agent) return;
    this.agent = agent;
    this.messages[0] = { role: 'system', content: this.systemPrompt() };
  }

  reset(): void {
    this.messages = [{ role: 'system', content: this.systemPrompt() }];
  }

  loadHistory(history: ProviderMessage[]): void {
    this.messages = [{ role: 'system', content: this.systemPrompt() }, ...history];
  }

  private async applyContext(prompt: string): Promise<void> {
    let report: ContextReport;
    try {
      report = await this.contextBuilder.build(prompt);
    } catch (error) {
      defaultLogger.warn('context build failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const base = this.systemPrompt();
    this.messages[0] = {
      role: 'system',
      content: report.text ? `${base}\n\n${CONTEXT_HEADER}\n${report.text}` : base,
    };
  }

  async *run(input: AgentRuntimeTurnInput): AsyncGenerator<AgentRuntimeEvent> {
    if (input.agent) this.setAgent(input.agent);
    await this.applyContext(input.prompt);
    await this.compactHistory(input.signal);
    this.messages.push({ role: 'user', content: input.prompt });

    let iterations = 0;
    let toolCalls = 0;

    try {
      while (true) {
        if (input.signal.aborted) {
          yield { type: 'halt', reason: 'cancelled' };
          return;
        }
        if (iterations >= this.maxIterations) {
          yield { type: 'halt', reason: 'iterations' };
          return;
        }
        if (this.tokensUsed >= this.tokenBudget) {
          yield { type: 'halt', reason: 'budget' };
          return;
        }
        if (Date.now() - this.startedAt >= this.durationBudget) {
          yield { type: 'halt', reason: 'duration' };
          return;
        }
        iterations += 1;

        const adapter = this.providers.get(this.provider);
        if (!adapter) {
          const switched = this.switchToFallback(
            new LareError('PROVIDER_UNAVAILABLE', `Provider "${this.provider}" is not available`)
          );
          if (switched) {
            yield* this.fallbackNotice(switched, 'provider unavailable');
            continue;
          }
          throw new LareError(
            'PROVIDER_UNAVAILABLE',
            `Provider "${this.provider}" is not available`
          );
        }

        const specs = adapter.capabilities.tools ? this.toolSpecs() : [];
        let reported: ProviderUsage | undefined;
        const deadline = createDeadline(this.requestTimeoutMs, input.signal);
        const completion: CompletionOptions = {
          model: this.model,
          abortSignal: deadline.signal,
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
            for await (const event of this.streamWithRetry(
              () => adapter.streamChat!(this.messages, completion),
              input.signal,
              deadline
            )) {
              if (input.signal.aborted) {
                yield { type: 'halt', reason: 'cancelled' };
                return;
              }
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
            for await (const chunk of this.streamWithRetry(
              () =>
                adapter.streamComplete(transcript, {
                  ...completion,
                  systemPrompt: this.messages[0]?.content,
                  tools: undefined,
                }),
              input.signal,
              deadline
            )) {
              if (input.signal.aborted) {
                yield { type: 'halt', reason: 'cancelled' };
                return;
              }
              streamedTokens += estimateTokens(chunk);
              if (this.tokensUsed + streamedTokens > this.tokenBudget) break;
              text += chunk;
              yield { type: 'text', text: chunk };
            }
          }
        } catch (error) {
          if (text === '' && calls.length === 0) {
            const switched = this.switchToFallback(error);
            if (switched) {
              yield* this.fallbackNotice(switched, 'provider error');
              continue;
            }
          }
          throw error;
        } finally {
          deadline.cancel();
        }

        this.recordUsage(text, reported);
        yield { type: 'usage', usage: this.usage.getAggregate() };

        if (text.trim() === '' && calls.length === 0) {
          const failure = new LareError('EMPTY_RESPONSE', 'provider returned an empty response', {
            retryable: true,
          });
          const switched = this.switchToFallback(failure);
          if (switched) {
            yield* this.fallbackNotice(switched, 'empty response');
            continue;
          }
          yield { type: 'error', error: failure.toJSON() };
          return;
        }

        const budgetHit = this.tokensUsed >= this.tokenBudget;
        this.messages.push({
          role: 'assistant',
          content: text,
          ...(calls.length > 0 && !budgetHit ? { toolCalls: calls } : {}),
        });

        if (calls.length === 0 || budgetHit) {
          yield { type: 'halt', reason: budgetHit ? 'budget' : 'completed' };
          return;
        }

        let exhausted = false;
        const resolved = new Set<string>();
        try {
          for (const call of calls) {
            if (input.signal.aborted) {
              yield { type: 'halt', reason: 'cancelled' };
              return;
            }
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
              yield {
                type: 'tool_end',
                callId: call.id,
                name: call.name,
                ok: false,
                output: parsed.error,
              };
              continue;
            }

            yield { type: 'tool_start', callId: call.id, name: call.name, args: parsed.args };
            const outcome = await this.executeTool(call, parsed.args, input.confirm, input.signal);
            resolved.add(call.id);
            yield {
              type: 'tool_end',
              callId: call.id,
              name: call.name,
              ok: outcome.ok,
              output: outcome.content,
            };
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

        if (exhausted) {
          yield { type: 'halt', reason: 'tool_calls' };
          return;
        }
      }
    } catch (error) {
      if (input.signal.aborted) {
        yield { type: 'halt', reason: 'cancelled' };
        return;
      }
      const failure =
        error instanceof LareError
          ? error
          : LareError.wrap('UNKNOWN', error instanceof Error ? error : new Error(String(error)));
      yield { type: 'error', error: failure.toJSON() };
    }
  }

  private async *streamWithRetry<T>(
    open: () => AsyncIterable<T>,
    signal: AbortSignal,
    deadline: RequestDeadline
  ): AsyncGenerator<T> {
    for (let attempt = 0; ; attempt += 1) {
      let emitted = false;
      try {
        for await (const item of open()) {
          emitted = true;
          yield item;
        }
        return;
      } catch (error) {
        if (deadline.timedOut() && !signal.aborted) {
          throw new LareError(
            'PROVIDER_TIMEOUT',
            `provider request timed out after ${this.requestTimeoutMs}ms`
          );
        }
        if (emitted || signal.aborted || attempt >= this.maxRetries || !isRetryable(error)) {
          throw error;
        }
        const baseDelay = Math.min(30_000, this.retryDelayMs * 2 ** attempt);
        await waitForRetry(Math.floor(baseDelay / 2 + (Math.random() * baseDelay) / 2), signal);
      }
    }
  }

  private systemPrompt(): string {
    return `${BUILTIN_AGENTS[this.agent].systemPrompt}\n\nWorking directory: ${this.workingDir}`;
  }

  private async executeTool(
    call: ProviderToolCall,
    args: unknown,
    confirm: AgentRuntimePermissionConfirm | undefined,
    signal: AbortSignal
  ): Promise<{ ok: boolean; content: string }> {
    const available = BUILTIN_AGENTS[this.agent].tools;
    if (!available.includes('*') && !available.includes(call.name)) {
      return {
        ok: false,
        content: `PERMISSION_DENIED: ${call.name} is not available to the ${this.agent} agent`,
      };
    }

    const tool = this.tools.get(call.name);
    if (!tool) {
      return { ok: false, content: `ERROR: Tool not found: ${call.name}` };
    }
    const invalid = validateToolArguments(tool, args);
    if (invalid) {
      return { ok: false, content: `ERROR: ${invalid}` };
    }

    const group = toolPermissionGroup(call.name);
    let decision = this.permissions.check(group, {
      source: 'chat',
      unattended: this.unattended,
    });

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
        if (signal.aborted) throw new LareError('CANCELLED', 'chat session cancelled');
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
    await this.checkpoint(`pre-tool ${call.name}`);
    const result = await this.tools.execute(toolCall, {
      sessionId: this.sessionId,
      workingDir: this.workingDir,
      permissions: this.permissions,
      abortSignal: signal,
    });
    await this.checkpoint(`post-tool ${call.name}`);
    return result.success
      ? { ok: true, content: renderOutput(result.output) }
      : { ok: false, content: `ERROR: ${result.error ?? 'tool failed'}` };
  }

  private async checkpoint(label: string): Promise<void> {
    if (!this.checkpoints) return;
    try {
      await this.checkpoints.create(label);
    } catch (error) {
      defaultLogger.warn('checkpoint failed', {
        label,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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
    const estimatedInput = estimateTokens(
      this.messages.map((message) => message.content).join('\n')
    );
    const ratio = reported ? tokenRatio(estimatedInput, reported.input) : undefined;
    if (ratio !== undefined) this.tokenRatioValue = this.tokenRatioValue * 0.7 + ratio * 0.3;
    const input = reported?.input ?? applyTokenRatio(estimatedInput, this.tokenRatioValue);
    const output = reported?.output ?? applyTokenRatio(estimateTokens(text), this.tokenRatioValue);
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
