import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  larecodeHome,
  redactSecrets,
  redactValue,
  type Session,
  type SessionMessage,
} from '@larecode/core';

export const SHARE_TOKEN_RE = /^[0-9a-f]{32,64}$/;

export interface ShareLink {
  token: string;
  sessionId: string;
  createdAt: Date;
}

interface StoredShare {
  token: string;
  sessionId: string;
  createdAt: string;
}

export function sharesPath(): string {
  return join(larecodeHome(), 'shares.json');
}

export class Shares {
  constructor(private readonly file: string = sharesPath()) {}

  private read(): ShareLink[] {
    if (!existsSync(this.file)) return [];
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredShare[];
      if (!Array.isArray(stored)) return [];
      return stored
        .filter((entry) => typeof entry?.token === 'string' && typeof entry?.sessionId === 'string')
        .map((entry) => ({
          token: entry.token,
          sessionId: entry.sessionId,
          createdAt: new Date(entry.createdAt),
        }));
    } catch {
      return [];
    }
  }

  private write(links: ShareLink[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const stored: StoredShare[] = links.map((link) => ({
      token: link.token,
      sessionId: link.sessionId,
      createdAt: link.createdAt.toISOString(),
    }));
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }

  create(sessionId: string): ShareLink {
    const link: ShareLink = {
      token: randomBytes(16).toString('hex'),
      sessionId,
      createdAt: new Date(),
    };
    this.write([...this.read(), link]);
    return link;
  }

  get(token: string): ShareLink | undefined {
    if (!SHARE_TOKEN_RE.test(token)) return undefined;
    return this.read().find((link) => link.token === token);
  }

  list(): ShareLink[] {
    return this.read();
  }

  remove(token: string): boolean {
    const links = this.read();
    const remaining = links.filter((link) => link.token !== token);
    if (remaining.length === links.length) return false;
    this.write(remaining);
    return true;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function renderPayload(label: string, payload: unknown): string {
  if (payload === undefined) return '';
  const json = JSON.stringify(redactValue(payload), null, 2) ?? '';
  return `<details><summary>${label}</summary><pre class="payload">${escapeHtml(json)}</pre></details>`;
}

function renderMessage(message: SessionMessage): string {
  const content = redactSecrets(message.content);
  const toolCalls = renderPayload(
    `${message.toolCalls?.length ?? 0} tool call${message.toolCalls?.length === 1 ? '' : 's'}`,
    message.toolCalls
  );
  const toolResults = renderPayload(
    `${message.toolResults?.length ?? 0} tool result${message.toolResults?.length === 1 ? '' : 's'}`,
    message.toolResults
  );
  return `<article class="message ${message.role}">
<header><span class="role">${message.role}</span><time>${escapeHtml(message.timestamp.toISOString())}</time></header>
<pre class="content">${escapeHtml(content)}</pre>
${toolCalls}${toolResults}
</article>`;
}

export function renderSharePage(session: Session): string {
  const title = `LareCode session ${session.id.slice(0, 8)}`;
  const messages = session.messages.map(renderMessage).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
body { margin: 0 auto; max-width: 48rem; padding: 2rem 1.25rem; background: #0d1117; color: #e6edf3; font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
.meta { color: #8b949e; margin-bottom: 2rem; }
.message { border: 1px solid #21262d; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
.message.user { border-color: #2f81f7; }
.message header { display: flex; justify-content: space-between; color: #8b949e; margin-bottom: .5rem; }
.message .role { text-transform: uppercase; letter-spacing: .06em; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
.payload { color: #8b949e; margin-top: .5rem; }
details summary { cursor: pointer; color: #8b949e; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(session.metadata.createdAt.toISOString())} · ${session.messages.length} messages · read-only replay</p>
${messages}
</body>
</html>
`;
}
