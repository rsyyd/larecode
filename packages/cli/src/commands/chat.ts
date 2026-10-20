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
      ? (request) => confirm({ tool: request.tool, group: request.group })
      : undefined;

    for await (const event of session.run(prompt, {
      signal,
      agent,
      confirm: confirmPermission,
    })) {
      if (event.type === 'text') {
        onChunk(event.text);
      } else if (event.type === 'tool_start') {
        onChunk(`\n⎿ ${event.name}\n`);
      } else {
        const summary = event.output.split('\n')[0]?.trim() ?? '';
        onChunk(
          `${event.ok ? '✓' : '✗'} ${event.name}${summary ? ` · ${summary.slice(0, 120)}` : ''}\n`
        );
      }
    }
  };

  await startTui({
    model,
    runTurn,
    getUsage: () => session.getUsage(),
    onClear: () => session.reset(),
  });
  return 0;
}
