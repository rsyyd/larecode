import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { larecodeHome } from '../config/config.js';
import { LareError } from '../error/error.js';
import { redactValue } from '../permission/redact.js';
import type { ProviderMessage } from '../provider/provider.js';
import type { ToolCall, ToolResult } from '../tool/tool.js';

export interface SessionMetadata {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  tokenUsage: number;
  cost: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: Date;
}

export interface Session {
  id: string;
  metadata: SessionMetadata;
  messages: SessionMessage[];
}

interface StoredMessage {
  role: SessionMessage['role'];
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  timestamp: string;
}

interface StoredSession {
  id: string;
  metadata: {
    id: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    tokenUsage: number;
    cost: number;
  };
  messages: StoredMessage[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function sessionsDir(): string {
  return join(larecodeHome(), 'sessions');
}

export function renderSessionContext(session: Session): string {
  return session.messages.map((message) => `${message.role}: ${message.content}`).join('\n');
}

export function toProviderHistory(messages: SessionMessage[]): ProviderMessage[] {
  return messages.flatMap((message) =>
    message.role === 'user' || message.role === 'assistant'
      ? [{ role: message.role, content: message.content }]
      : []
  );
}

function toStored(session: Session): StoredSession {
  return {
    id: session.id,
    metadata: {
      ...session.metadata,
      createdAt: session.metadata.createdAt.toISOString(),
      updatedAt: session.metadata.updatedAt.toISOString(),
    },
    messages: session.messages.map((message) => ({
      ...message,
      timestamp: message.timestamp.toISOString(),
    })),
  };
}

function fromStored(stored: StoredSession): Session {
  return {
    id: stored.id,
    metadata: {
      ...stored.metadata,
      createdAt: new Date(stored.metadata.createdAt),
      updatedAt: new Date(stored.metadata.updatedAt),
    },
    messages: stored.messages.map((message) => ({
      ...message,
      toolCalls: message.toolCalls as ToolCall[] | undefined,
      toolResults: message.toolResults as ToolResult[] | undefined,
      timestamp: new Date(message.timestamp),
    })),
  };
}

export class Sessions {
  private sessions = new Map<string, Session>();

  constructor(private dir: string = sessionsDir()) {}

  private fileFor(id: string): string | null {
    if (!SAFE_ID.test(id)) return null;
    return join(this.dir, `${id}.json`);
  }

  create(initialMessage?: string): Session {
    const id = crypto.randomUUID();
    const now = new Date();
    const session: Session = {
      id,
      metadata: {
        id,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        tokenUsage: 0,
        cost: 0,
      },
      messages: [],
    };
    if (initialMessage) {
      session.messages.push({ role: 'user', content: initialMessage, timestamp: now });
      session.metadata.messageCount = 1;
    }
    this.sessions.set(id, session);
    this.persist(session);
    return session;
  }

  get(id: string): Session | undefined {
    const cached = this.sessions.get(id);
    if (cached) return cached;
    const file = this.fileFor(id);
    if (!file || !existsSync(file)) return undefined;
    const session = this.read(file);
    this.sessions.set(id, session);
    return session;
  }

  list(): SessionMetadata[] {
    if (!existsSync(this.dir)) return [];
    const out: SessionMetadata[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(this.read(join(this.dir, name)).metadata);
      } catch {
        continue;
      }
    }
    return out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  save(session: Session): void {
    session.metadata.updatedAt = new Date();
    session.metadata.messageCount = session.messages.length;
    this.sessions.set(session.id, session);
    this.persist(session);
  }

  delete(id: string): boolean {
    const file = this.fileFor(id);
    if (!file) return false;
    const cached = this.sessions.delete(id);
    if (!existsSync(file)) return cached;
    rmSync(file);
    return true;
  }

  private persist(session: Session): void {
    const file = this.fileFor(session.id);
    if (!file) {
      throw new LareError('SESSION_NOT_FOUND', `invalid session id "${session.id}"`);
    }
    mkdirSync(this.dir, { recursive: true });
    const redacted = redactValue(toStored(session)) as StoredSession;
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(redacted, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  }

  private read(file: string): Session {
    try {
      return fromStored(JSON.parse(readFileSync(file, 'utf8')) as StoredSession);
    } catch (error) {
      throw LareError.wrap('SESSION_CORRUPTED', error as Error, { file });
    }
  }
}
