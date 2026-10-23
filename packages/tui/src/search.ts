import { stripTerminal } from './markdown.js';
import type { ChatMessage } from './messages.js';

export interface MessageHit {
  index: number;
  role: ChatMessage['role'];
  preview: string;
}

export function searchMessages(messages: ChatMessage[], query: string): MessageHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: MessageHit[] = [];
  messages.forEach((message, index) => {
    const text = stripTerminal(message.text);
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0) return;
    const start = Math.max(0, at - 30);
    const end = Math.min(text.length, at + needle.length + 30);
    const preview = text.slice(start, end).replace(/\s+/g, ' ').trim();
    hits.push({ index, role: message.role, preview });
  });
  return hits;
}
