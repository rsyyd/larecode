import { randomUUID } from 'node:crypto';
import {
  ChatSession,
  Permissions,
  Providers,
  Tools,
  backendFromConfig,
  coreTools,
  loadEffectiveConfig,
  providersFromConfig,
  type ChatPermissionConfirm,
} from '@larecode/core';
import { startTui, type AppProps } from '@larecode/tui';

export interface ChatCommandOptions {
  provider?: string;
  model?: string;
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

  const providers = new Providers();
  for (const adapter of providersFromConfig(config)) providers.register(adapter);

  const tools = new Tools();
  for (const tool of coreTools({ backend: backendFromConfig(config) })) tools.register(tool);

  const session = new ChatSession({
    provider,
    model,
    providers,
    tools,
    permissions: new Permissions(config.permissions),
    workingDir: process.cwd(),
    sessionId: randomUUID(),
  });

  const runTurn: AppProps['runTurn'] = async (prompt, onChunk, signal, agent, confirm) => {
    const confirmPermission: ChatPermissionConfirm | undefined = confirm
      ? (request) =>
          confirm({ tool: request.tool, group: request.group, detail: toolDetail(request.args) })
      : undefined;

    let detail = '';
    for await (const event of session.run(prompt, {
      signal,
      agent,
      confirm: confirmPermission,
    })) {
      if (event.type === 'text') {
        onChunk(event.text);
      } else if (event.type === 'tool_start') {
        detail = toolDetail(event.args);
        onChunk(`\n⎿ ${event.name}${detail ? ` · ${detail}` : ''}\n`);
      } else {
        onChunk(`${event.ok ? '✓' : '✗'} ${event.name}${detail ? ` · ${detail}` : ''}\n`);
        detail = '';
      }
    }
  };

  await startTui({
    provider,
    model,
    runTurn,
    catalogs: Object.entries(config.providers).map(([name, entry]) => ({
      provider: name,
      models: entry.models,
    })),
    onSelectModel: (nextProvider, nextModel) => session.selectModel(nextProvider, nextModel),
    getUsage: () => session.getUsage(),
    onClear: () => session.reset(),
  });
  return 0;
}
