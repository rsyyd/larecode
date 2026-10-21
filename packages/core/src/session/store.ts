import { randomUUID } from 'node:crypto';
import type { Session, SessionMetadata } from './session.js';
import { Sessions } from './session.js';

export interface SessionStore {
  create(initialMessage?: string): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  save(session: Session): Promise<void>;
  list(): Promise<SessionMetadata[]>;
  delete(id: string): Promise<boolean>;
}

function freshSession(initialMessage?: string): Session {
  const id = randomUUID();
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
  return session;
}

function touch(session: Session): void {
  session.metadata.updatedAt = new Date();
  session.metadata.messageCount = session.messages.length;
}

export class FileSessionStore implements SessionStore {
  private readonly sessions: Sessions;

  constructor(dir?: string) {
    this.sessions = new Sessions(dir);
  }

  async create(initialMessage?: string): Promise<Session> {
    return this.sessions.create(initialMessage);
  }

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async save(session: Session): Promise<void> {
    this.sessions.save(session);
  }

  async list(): Promise<SessionMetadata[]> {
    return this.sessions.list();
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  async create(initialMessage?: string): Promise<Session> {
    const session = freshSession(initialMessage);
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async save(session: Session): Promise<void> {
    touch(session);
    this.sessions.set(session.id, session);
  }

  async list(): Promise<SessionMetadata[]> {
    return [...this.sessions.values()]
      .map((session) => session.metadata)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }
}
