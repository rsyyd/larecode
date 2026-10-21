import {
  ChatSession,
  Checkpoints,
  Permissions,
  Providers,
  Sessions,
  connectMcpTools,
  createSubagents,
  loadEffectiveConfig,
  providersFromConfig,
  toProviderHistory,
  type ChatPermissionConfirm,
  type Session,
  type UsageAggregate,
} from '@larecode/core';
import { startTui, type AppProps, type ChatMessage } from '@larecode/tui';

export interface ChatCommandOptions {
  provider?: string;
  model?: string;
  resume?: string;
}

export function startTurn(sessions: Sessions, stored: Session, prompt: string): void {
  if (!stored.metadata.title) stored.metadata.title = prompt.trim().slice(0, 80);
  stored.messages.push({ role: 'user', content: prompt, timestamp: new Date() });
  sessions.save(stored);
}

export function finishTurn(
  sessions: Sessions,
  stored: Session,
  assistant: string,
  usage: UsageAggregate
): void {
  if (assistant !== '') {
    stored.messages.push({ role: 'assistant', content: assistant, timestamp: new Date() });
  }
  stored.metadata.tokenUsage = usage.totalTokens.total;
  stored.metadata.cost = usage.totalCost.totalCost;
  sessions.save(stored);
}

export function sessionMessages(session: Session): ChatMessage[] {
  return session.messages.flatMap((message) =>
    message.role === 'user' || message.role === 'assistant'
      ? [{ role: message.role === 'user' ? 'user' : 'agent', text: message.content }]
      : []
  );
}

function toolDetail(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  for (const key of ['command', 'path', 'file_path', 'filePath', 'pattern', 'query', 'url']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replace(/\s+/g, ' ').slice(0, 80);
    }
  }
  return '';
}

export async function chatCommand(options: ChatCommandOptions = {}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      'larecode: interactive mode needs a terminal. Use `larecode run "<task>"` instead.\n'
    );
    return 1;
  }

  const config = loadEffectiveConfig();
  const provider = options.provider ?? config.defaultProvider;
  const model = options.model ?? config.defaultModel;

  const sessions = new Sessions();
  const resumed = options.resume ? sessions.get(options.resume) : undefined;
  if (options.resume && !resumed) {
    process.stderr.write(`larecode: session "${options.resume}" not found\n`);
    return 1;
  }
  const stored =
    resumed ??
    sessions.create(undefined, {
      provider,
      model,
      workingDir: process.cwd(),
    });

  const providers = new Providers();
  for (const adapter of providersFromConfig(config)) providers.register(adapter);

  const permissions = new Permissions(config.permissions);
  const mcp = await connectMcpTools(config.mcpServers);

  const session = new ChatSession({
    provider,
    model,
    providers,
    permissions,
    extraTools: mcp.tools,
    workingDir: process.cwd(),
    sessionId: stored.id,
    history: toProviderHistory(stored.messages),
    checkpoints: config.checkpoints
      ? new Checkpoints({ root: process.cwd(), sessionId: stored.id })
      : undefined,
  });

  const runTurn: AppProps['runTurn'] = async (prompt, onChunk, signal, agent, confirm) => {
    const confirmPermission: ChatPermissionConfirm | undefined = confirm
      ? (request) =>
          confirm({ tool: request.tool, group: request.group, detail: toolDetail(request.args) })
      : undefined;

    let detail = '';
    let assistant = '';
    startTurn(sessions, stored, prompt);
    try {
      for await (const event of session.run(prompt, {
        signal,
        agent,
        confirm: confirmPermission,
      })) {
        if (event.type === 'text') {
          assistant += event.text;
          onChunk(event.text);
        } else if (event.type === 'tool_start') {
          detail = toolDetail(event.args);
          onChunk(`\n⎿ ${event.name}${detail ? ` · ${detail}` : ''}\n`);
        } else if (event.type === 'fallback') {
          onChunk(`\n↪ fallback ${event.from} → ${event.provider}/${event.model}\n`);
        } else {
          onChunk(`${event.ok ? '✓' : '✗'} ${event.name}${detail ? ` · ${detail}` : ''}\n`);
          detail = '';
        }
      }
    } finally {
      finishTurn(sessions, stored, assistant, session.getUsage());
    }
  };

  const subagents = createSubagents({ providers, permissions, workingDir: process.cwd() });
  const runSubagentTurn: AppProps['runSubagentTurn'] = async (prompt, onChunk, signal) => {
    const result = await subagents.run({
      prompt,
      agent: 'general',
      provider: session.getProvider(),
      model: session.getModel(),
      signal,
    });
    onChunk(result.text);
  };

  try {
    await startTui({
      provider,
      model,
      initialMessages: sessionMessages(stored),
      runTurn,
      runSubagentTurn,
      catalogs: Object.entries(config.providers).map(([name, entry]) => ({
        provider: name,
        models: entry.models,
      })),
      onSelectModel: (nextProvider, nextModel) => {
        session.selectModel(nextProvider, nextModel);
        stored.metadata.provider = nextProvider;
        stored.metadata.model = nextModel;
        sessions.save(stored);
      },
      getUsage: () => session.getUsage(),
      getContext: () => session.getContextReport(),
      onClear: () => session.reset(),
    });
  } finally {
    await mcp.close();
  }
  return 0;
}
