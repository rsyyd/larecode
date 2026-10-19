import { createInterface } from 'node:readline';
import { Sessions, VERSION } from '@larecode/core';
import { LareClient } from './client.js';

export const ACP_PROTOCOL_VERSION = 1;

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'cancelled' | 'refusal';

export interface AcpTurnContext {
  sessionId: string;
  signal: AbortSignal;
  onChunk: (text: string) => void;
}

export type AcpTurnHandler = (prompt: string, context: AcpTurnContext) => Promise<AcpStopReason>;

export interface AcpAgentOptions {
  name?: string;
  title?: string;
  version?: string;
  send?: (message: unknown) => void;
  runTurn?: AcpTurnHandler;
  sessions?: Sessions;
  workingDir?: string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const NOT_FOUND = -32004;

interface PendingSession {
  abort: AbortController | null;
}

export class AcpAgent {
  private readonly name: string;
  private readonly title: string;
  private readonly version: string;
  private readonly send: (message: unknown) => void;
  private readonly sessions: Sessions;
  private readonly turn: AcpTurnHandler;
  private readonly pending = new Map<string, PendingSession>();

  constructor(options: AcpAgentOptions = {}) {
    this.name = options.name ?? 'larecode';
    this.title = options.title ?? "Every agent's best, in one CLI";
    this.version = options.version ?? VERSION;
    this.send =
      options.send ?? ((message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`));
    this.sessions = options.sessions ?? new Sessions();
    const client = new LareClient({
      workingDir: options.workingDir,
      sessions: this.sessions,
    });
    this.turn =
      options.runTurn ??
      (async (prompt, context) => {
        const result = await client.run(prompt, {
          sessionId: context.sessionId,
          signal: context.signal,
          onChunk: context.onChunk,
        });
        return result.stopReason;
      });
  }

  async serve(): Promise<void> {
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      await this.handleLine(line);
    }
  }

  async handleLine(line: string): Promise<void> {
    const text = line.trim();
    if (text.length === 0) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(text) as JsonRpcRequest;
    } catch {
      this.error(null, PARSE_ERROR, 'invalid JSON');
      return;
    }

    const isNotification = request.id === undefined || request.id === null;
    try {
      if (isNotification) {
        this.handleNotification(request);
        return;
      }
      const result = await this.handleRequest(request);
      this.respond(request.id, result);
    } catch (error) {
      const { code, message } = describeError(error);
      if (!isNotification) this.error(request.id ?? null, code, message);
    }
  }

  private handleNotification(request: JsonRpcRequest): void {
    if (request.method === 'session/cancel') {
      const sessionId = (request.params as { sessionId?: string } | undefined)?.sessionId;
      if (sessionId) this.pending.get(sessionId)?.abort?.abort();
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.initialize();
      case 'session/new':
        return this.sessionNew();
      case 'session/prompt':
        return await this.sessionPrompt(request.params);
      default:
        throw new AcpError(METHOD_NOT_FOUND, `method "${request.method}" is not supported`);
    }
  }

  private initialize(): unknown {
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {},
      },
      agentInfo: {
        name: this.name,
        title: this.title,
        version: this.version,
      },
      authMethods: [],
    };
  }

  private sessionNew(): unknown {
    const session = this.sessions.create();
    this.pending.set(session.id, { abort: null });
    return { sessionId: session.id };
  }

  private async sessionPrompt(params: unknown): Promise<unknown> {
    const { sessionId, prompt } = (params ?? {}) as { sessionId?: string; prompt?: unknown };
    if (!sessionId) throw new AcpError(INVALID_PARAMS, 'sessionId is required');
    const pending = this.pending.get(sessionId);
    if (!pending) throw new AcpError(NOT_FOUND, `unknown session "${sessionId}"`);

    const text = extractPromptText(prompt);
    const abort = new AbortController();
    pending.abort = abort;
    try {
      const stopReason = await this.turn(text, {
        sessionId,
        signal: abort.signal,
        onChunk: (chunk) => {
          this.send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: chunk },
              },
            },
          });
        },
      });
      return { stopReason };
    } finally {
      pending.abort = null;
    }
  }

  private respond(id: number | string | null | undefined, result: unknown): void {
    this.send({ jsonrpc: '2.0', id: id ?? null, result });
  }

  private error(id: number | string | null, code: number, message: string): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }
}

class AcpError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

function describeError(error: unknown): { code: number; message: string } {
  if (error instanceof AcpError) return { code: error.code, message: error.message };
  return {
    code: INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
  };
}

function extractPromptText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return '';
  return prompt
    .map((block) => {
      const content = block as { type?: string; text?: string };
      return content.type === 'text' ? (content.text ?? '') : '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
}
