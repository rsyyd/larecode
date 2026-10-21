import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Permissions,
  Sessions,
  assertPreAuthorizable,
  larecodeHome,
  toProviderHistory,
  type PermissionGroup,
  type ProviderMessage,
} from '@larecode/core';

export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;
export const TELEGRAM_DEFAULT_API_BASE = 'https://api.telegram.org';

export interface GatewayLoop {
  run(prompt: string): AsyncGenerator<string>;
  getUsage(): { totalTokens: { total: number }; totalCost: { totalCost: number } };
  getHaltReason(): string | null;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number | string };
    text?: string;
    from?: { id: number; username?: string };
  };
}

export interface ChatSessionsStore {
  getOrCreate(chatId: string): string;
  reset(chatId: string): string;
}

export function gatewayPath(): string {
  return join(larecodeHome(), 'gateway.json');
}

export class ChatSessions implements ChatSessionsStore {
  constructor(
    private readonly file: string = gatewayPath(),
    private readonly sessions: Sessions = new Sessions()
  ) {}

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
      return typeof stored === 'object' && stored !== null ? stored : {};
    } catch {
      return {};
    }
  }

  private write(map: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(map, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }

  getOrCreate(chatId: string): string {
    const map = this.read();
    const existing = map[chatId];
    if (existing !== undefined && this.sessions.get(existing)) return existing;
    const session = this.sessions.create();
    this.write({ ...map, [chatId]: session.id });
    return session.id;
  }

  reset(chatId: string): string {
    const map = this.read();
    const session = this.sessions.create();
    this.write({ ...map, [chatId]: session.id });
    return session.id;
  }
}

export function chunkText(text: string, max = TELEGRAM_MAX_MESSAGE_CHARS): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export interface TelegramGatewayOptions {
  token: string;
  allowedChatId?: string;
  policy?: PermissionGroup[];
  sessions?: Sessions;
  chatSessions?: ChatSessionsStore;
  createLoop?: (options: {
    provider: string;
    model: string;
    permissions?: Permissions;
    unattended?: boolean;
    history?: ProviderMessage[];
    abortSignal?: AbortSignal;
  }) => GatewayLoop;
  loadConfig?: (cwd?: string) => { defaultProvider: string; defaultModel: string };
  fetchImpl?: typeof fetch;
  apiBase?: string;
  pollTimeoutSeconds?: number;
  errorDelayMs?: number;
  write?: (text: string) => void;
  now?: () => Date;
}

const HELP = [
  'send me a task and I run it on the host, unattended',
  '/new start a fresh conversation',
  '/status show session and model details',
  '/help show this message',
].join('\n');

export class TelegramGateway {
  readonly policy: PermissionGroup[];
  private readonly token: string;
  private readonly allowedChatId?: string;
  private readonly sessions: Sessions;
  private readonly chatSessions: ChatSessionsStore;
  private readonly permissions: Permissions;
  private readonly createLoop: NonNullable<TelegramGatewayOptions['createLoop']>;
  private readonly loadConfig: NonNullable<TelegramGatewayOptions['loadConfig']>;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly pollTimeoutSeconds: number;
  private readonly errorDelayMs: number;
  private readonly write: (text: string) => void;
  private readonly now: () => Date;

  constructor(options: TelegramGatewayOptions) {
    this.token = options.token;
    this.allowedChatId = options.allowedChatId;
    this.policy = assertPreAuthorizable(options.policy ?? []);
    this.permissions = new Permissions({
      mode: 'ask',
      allowedGroups: [],
      preAuthorized: { gateway: this.policy },
    });
    this.sessions = options.sessions ?? new Sessions();
    this.chatSessions = options.chatSessions ?? new ChatSessions(gatewayPath(), this.sessions);
    this.createLoop =
      options.createLoop ??
      (() => {
        throw new Error('no loop factory configured for the gateway');
      });
    this.loadConfig =
      options.loadConfig ?? (() => ({ defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' }));
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.apiBase = options.apiBase ?? TELEGRAM_DEFAULT_API_BASE;
    this.pollTimeoutSeconds = options.pollTimeoutSeconds ?? 25;
    this.errorDelayMs = options.errorDelayMs ?? 5_000;
    this.write = options.write ?? (() => {});
    this.now = options.now ?? (() => new Date());
  }

  private apiUrl(method: string): string {
    return `${this.apiBase}/bot${this.token}/${method}`;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    for (const chunk of chunkText(text)) {
      const response = await this.fetchImpl(this.apiUrl('sendMessage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
      });
      if (!response.ok) {
        this.write(`telegram: sendMessage failed with ${response.status}\n`);
      }
    }
  }

  private async getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const url = `${this.apiUrl('getUpdates')}?offset=${offset}&timeout=${this.pollTimeoutSeconds}`;
    const response = await this.fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`getUpdates failed with ${response.status}`);
    const body = (await response.json()) as { ok: boolean; result?: TelegramUpdate[] };
    return body.result ?? [];
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const text = message?.text?.trim();
    if (!message || !text) return;
    const chatId = String(message.chat.id);

    if (this.allowedChatId === undefined || this.allowedChatId !== chatId) {
      await this.sendMessage(
        chatId,
        `this bot is not authorized for this chat (chat id ${chatId}). set LARECODE_TELEGRAM_CHAT_ID=${chatId} to enable it.`
      );
      return;
    }

    if (text === '/start' || text === '/help') {
      await this.sendMessage(chatId, HELP);
      return;
    }
    if (text === '/new' || text === '/reset') {
      this.chatSessions.reset(chatId);
      await this.sendMessage(chatId, 'started a fresh conversation');
      return;
    }
    if (text === '/status') {
      const config = this.loadConfig();
      const sessionId = this.chatSessions.getOrCreate(chatId);
      const session = this.sessions.get(sessionId);
      await this.sendMessage(
        chatId,
        [
          `session: ${sessionId}`,
          `provider: ${config.defaultProvider}`,
          `model: ${config.defaultModel}`,
          `messages: ${session?.messages.length ?? 0}`,
          `allowed groups: ${this.policy.join(', ') || 'none'}`,
        ].join('\n')
      );
      return;
    }

    const sessionId = this.chatSessions.getOrCreate(chatId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      await this.sendMessage(chatId, 'error: session store unavailable');
      return;
    }
    const history = toProviderHistory(session.messages);
    session.messages.push({ role: 'user', content: text, timestamp: this.now() });
    this.sessions.save(session);

    const reply = await this.runTurn(text, history);
    session.messages.push({ role: 'assistant', content: reply, timestamp: this.now() });
    this.sessions.save(session);
    await this.sendMessage(chatId, reply.length > 0 ? reply : 'done (no output)');
  }

  private async runTurn(prompt: string, history: ProviderMessage[]): Promise<string> {
    const config = this.loadConfig();
    const loop = this.createLoop({
      provider: config.defaultProvider,
      model: config.defaultModel,
      permissions: this.permissions,
      unattended: true,
      history,
    });
    let output = '';
    try {
      for await (const chunk of loop.run(prompt)) output += chunk;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return output.length > 0 ? `${output}\nerror: ${message}` : `error: ${message}`;
    }
    return output;
  }

  async run(signal: AbortSignal): Promise<void> {
    const target = this.allowedChatId ?? 'unconfigured (all chats will be told their id)';
    this.write(`telegram: polling for chat ${target}\n`);
    let offset = 0;
    while (!signal.aborted) {
      try {
        const updates = await this.getUpdates(offset, signal);
        for (const update of updates) {
          offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        if (signal.aborted) break;
        const message = error instanceof Error ? error.message : String(error);
        this.write(`telegram: poll failed: ${message}\n`);
        await new Promise((resolve) => setTimeout(resolve, this.errorDelayMs));
      }
    }
    this.write('telegram: stopped\n');
  }
}
