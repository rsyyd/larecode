import {
  AgentLoop,
  assertPreAuthorizable,
  loadEffectiveConfig,
  type PermissionGroup,
} from '@larecode/core';
import { TelegramGateway, type TelegramGatewayOptions } from '@larecode/gateway';

export interface GatewayOptions {
  platform?: string;
  token?: string;
  chat?: string;
  allow?: string;
}

export interface GatewayDeps {
  env?: Record<string, string | undefined>;
  create?: (options: TelegramGatewayOptions) => { run(signal: AbortSignal): Promise<void> };
  write?: (text: string) => void;
  signal?: AbortSignal;
}

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bad = (text: string) => `\x1b[31m${text}\x1b[0m`;

function defaultLoop(options: {
  provider: string;
  model: string;
  abortSignal?: AbortSignal;
}): AgentLoop {
  return new AgentLoop({
    provider: options.provider,
    model: options.model,
    maxIterations: 40,
    maxToolCalls: 200,
    tokenBudget: 200_000,
    durationBudget: 600_000,
    abortSignal: options.abortSignal,
  });
}

function parseAllow(allow?: string): PermissionGroup[] {
  if (!allow) return [];
  return allow
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group.length > 0) as PermissionGroup[];
}

export async function gatewayCommand(
  options: GatewayOptions,
  deps: GatewayDeps = {}
): Promise<number> {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const env = deps.env ?? process.env;
  const platform = options.platform ?? 'telegram';

  if (platform !== 'telegram') {
    write(`${bad('gateway:')} unknown platform "${platform}" (supported: telegram)\n`);
    return 1;
  }
  const token = options.token ?? env.LARECODE_TELEGRAM_TOKEN;
  if (!token) {
    write(`${bad('gateway:')} telegram bot token required (--token or LARECODE_TELEGRAM_TOKEN)\n`);
    return 1;
  }
  const chat = options.chat ?? env.LARECODE_TELEGRAM_CHAT_ID;

  let policy: PermissionGroup[];
  try {
    policy = assertPreAuthorizable(parseAllow(options.allow));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`${bad('gateway:')} ${message}\n`);
    return 1;
  }

  const controller = new AbortController();
  const signal = deps.signal ?? controller.signal;
  if (!deps.signal) {
    process.once('SIGINT', () => controller.abort());
    process.once('SIGTERM', () => controller.abort());
  }

  const create = deps.create ?? ((gatewayOptions) => new TelegramGateway(gatewayOptions));
  const gateway = create({
    token,
    allowedChatId: chat,
    policy,
    createLoop: defaultLoop,
    loadConfig: loadEffectiveConfig,
    apiBase: env.LARECODE_TELEGRAM_API_BASE,
    write,
  });

  write(
    `${dim(`gateway: telegram listening for ${chat ?? 'an unconfigured chat'} · policy ${policy.join(',') || 'none'}`)}\n`
  );
  try {
    await gateway.run(signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`${bad('gateway:')} ${message}\n`);
    return 1;
  }
  write(`${dim('gateway: stopped')}\n`);
  return 0;
}
