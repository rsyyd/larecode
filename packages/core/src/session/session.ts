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

export class Sessions {
  private sessions = new Map<string, Session>();

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
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionMetadata[] {
    return Array.from(this.sessions.values()).map((session) => session.metadata);
  }

  save(session: Session): void {
    session.metadata.updatedAt = new Date();
    this.sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}
