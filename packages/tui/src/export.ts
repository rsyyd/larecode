import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTerminal } from './markdown.js';
import type { ChatMessage } from './messages.js';

export function conversationMarkdown(messages: ChatMessage[]): string {
  const sections = messages.map((message) => {
    const title = message.role === 'agent' ? 'assistant' : message.role;
    return `## ${title}\n\n${stripTerminal(message.text).trim()}\n`;
  });
  return `# larecode conversation\n\n${sections.join('\n')}`;
}

export function exportConversation(
  messages: ChatMessage[],
  path: string,
  cwd = process.cwd()
): string {
  const target = resolve(cwd, path);
  writeFileSync(target, conversationMarkdown(messages), { mode: 0o600 });
  return target;
}

export interface ClipboardDeps {
  platform?: NodeJS.Platform;
  spawn?: typeof spawnSync;
}

export function copyToClipboard(text: string, deps: ClipboardDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? spawnSync;
  const candidates: Array<[string, string[]]> =
    platform === 'darwin'
      ? [['pbcopy', []]]
      : platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
          ];
  for (const [command, args] of candidates) {
    const result = spawn(command, args, { input: text, encoding: 'utf8' });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}
