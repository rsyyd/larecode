import { estimateTokens } from '../usage/usage.js';

export const CONTEXT_ALLOCATION = {
  system: 0.15,
  instructions: 0.25,
  retrieval: 0.2,
  memory: 0.1,
  history: 0.2,
  output: 0.1,
} as const;

export type ContextSectionName = keyof typeof CONTEXT_ALLOCATION;
export type ContextInputName = Exclude<ContextSectionName, 'output'>;

const ORDER: ContextInputName[] = ['system', 'instructions', 'retrieval', 'memory', 'history'];
const MARKER = '\n…\n';

export interface ContextSection {
  name: ContextInputName;
  content: string;
}

export interface ContextSectionReport {
  name: ContextSectionName;
  tokens: number;
  truncated: boolean;
}

export interface AssembledContext {
  text: string;
  used: number;
  reserved: number;
  total: number;
  sections: ContextSectionReport[];
}

function truncate(content: string, maxTokens: number): { text: string; truncated: boolean } {
  if (estimateTokens(content) <= maxTokens) return { text: content, truncated: false };
  const maxChars = Math.max(0, maxTokens * 4 - MARKER.length);
  if (maxChars === 0) return { text: '', truncated: true };
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  return {
    text: `${content.slice(0, head).trimEnd()}${MARKER}${content.slice(-tail).trimStart()}`,
    truncated: true,
  };
}

export function assembleContext(sections: ContextSection[], totalTokens: number): AssembledContext {
  const total = Math.max(0, Math.floor(totalTokens));
  const reserved = Math.floor(total * CONTEXT_ALLOCATION.output);
  const available = total - reserved;
  const byName = new Map(sections.map((section) => [section.name, section.content]));
  const reports: ContextSectionReport[] = [];
  const included: string[] = [];
  let used = 0;
  let allocated = 0;

  for (const name of ORDER) {
    allocated += Math.floor(total * CONTEXT_ALLOCATION[name]);
    const content = byName.get(name) ?? '';
    if (content.trim() === '') continue;
    const limit = Math.min(allocated, available) - used;
    const { text, truncated } = truncate(content, Math.max(0, limit));
    const tokens = estimateTokens(text);
    used += tokens;
    reports.push({ name, tokens, truncated });
    if (text !== '') included.push(text);
  }

  reports.push({ name: 'output', tokens: reserved, truncated: false });
  return {
    text: included.join('\n\n'),
    used,
    reserved,
    total,
    sections: reports,
  };
}
