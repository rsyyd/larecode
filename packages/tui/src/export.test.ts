import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { conversationMarkdown, copyToClipboard, exportConversation } from './export.js';
import type { ChatMessage } from './messages.js';

const messages: ChatMessage[] = [
  { role: 'user', text: 'hello' },
  { role: 'agent', text: 'world\x1b[31m!' },
  { role: 'tool', text: 'read · a.ts' },
];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('conversation export', () => {
  it('renders a markdown transcript without terminal escapes', () => {
    const text = conversationMarkdown(messages);
    expect(text).toContain('# larecode conversation');
    expect(text).toContain('## user\n\nhello');
    expect(text).toContain('## assistant\n\nworld!');
    expect(text).not.toContain('\x1b');
  });

  it('writes the transcript with owner-only permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'larecode-export-'));
    dirs.push(dir);
    const target = exportConversation(messages, 'chat.md', dir);
    expect(target).toBe(join(dir, 'chat.md'));
    expect(readFileSync(target, 'utf8')).toContain('## tool');
  });

  it('uses the platform clipboard command and falls back when it is missing', () => {
    const calls: string[] = [];
    const spawn = ((command: string) => {
      calls.push(command);
      return command === 'xclip' ? { status: 0 } : { status: 1, error: new Error('missing') };
    }) as unknown as typeof import('node:child_process').spawnSync;

    expect(copyToClipboard('text', { platform: 'linux', spawn })).toBe(true);
    expect(calls).toEqual(['wl-copy', 'xclip']);
    const missing = (() => ({ status: 1, error: new Error('missing') })) as never;
    expect(copyToClipboard('text', { platform: 'linux', spawn: missing })).toBe(false);
    const mac = ((command: string) => ({ status: command === 'pbcopy' ? 0 : 1 })) as never;
    expect(copyToClipboard('text', { platform: 'darwin', spawn: mac })).toBe(true);
  });
});
