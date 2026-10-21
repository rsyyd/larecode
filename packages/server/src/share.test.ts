import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '@larecode/core';
import { Shares, escapeHtml, renderSharePage } from './share.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-share-'));
  file = join(dir, 'shares.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Shares', () => {
  it('creates, loads, and removes links with a persisted file', async () => {
    const shares = new Shares(file);
    const link = shares.create('session-1');
    expect(link.token).toMatch(/^[0-9a-f]{32}$/);
    expect(shares.get(link.token)?.sessionId).toBe('session-1');

    const reloaded = new Shares(file);
    expect(reloaded.get(link.token)?.sessionId).toBe('session-1');
    expect(reloaded.list()).toHaveLength(1);

    expect(reloaded.remove(link.token)).toBe(true);
    expect(reloaded.get(link.token)).toBeUndefined();
    expect(reloaded.remove(link.token)).toBe(false);
  });

  it('removes every link that belongs to a session', () => {
    const shares = new Shares(file);
    shares.create('session-1');
    shares.create('session-2');
    shares.create('session-1');

    expect(shares.removeForSession('session-1')).toBe(2);
    expect(shares.list().map((link) => link.sessionId)).toEqual(['session-2']);
    expect(shares.removeForSession('missing')).toBe(0);
  });

  it('writes the share file owner-only', async () => {
    new Shares(file).create('session-1');
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rejects malformed tokens', () => {
    const shares = new Shares(file);
    const link = shares.create('session-1');
    expect(shares.get('../etc/passwd')).toBeUndefined();
    expect(shares.get(link.token.toUpperCase())).toBeUndefined();
  });
});

function sessionWith(content: string): Session {
  const now = new Date('2026-10-01T10:00:00Z');
  return {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    metadata: {
      id: 'abcdef12-3456-7890-abcd-ef1234567890',
      createdAt: now,
      updatedAt: now,
      messageCount: 2,
      tokenUsage: 10,
      cost: 0.001,
    },
    messages: [
      {
        role: 'user',
        content,
        timestamp: now,
        toolCalls: [
          { id: 'c1', name: 'bash', arguments: { command: 'echo sk-ant-abcdefghijklmnop' } },
        ],
      },
      { role: 'assistant', content: 'done', timestamp: now },
    ],
  };
}

describe('renderSharePage', () => {
  it('renders a read-only replay with escaped content', () => {
    const html = renderSharePage(sessionWith('use <script>alert(1)</script> here'));
    expect(html).toContain('LareCode session abcdef12');
    expect(html).toContain('read-only replay');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('class="message user"');
    expect(html).toContain('2 messages');
  });

  it('redacts secrets in message text and tool payloads', () => {
    const html = renderSharePage(sessionWith('my key is sk-ant-abcdefghijklmnop'));
    expect(html).not.toContain('sk-ant-abcdefghijklmnop');
    expect(html).toContain('[REDACTED]');
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
