import type { ProviderMessage } from '../provider/provider.js';
import type { SessionMessage } from '../session/session.js';
import { estimateTokens } from '../usage/usage.js';

export const SUMMARY_MARKER = '[compacted summary]';
export const CLEARED_TOOL_RESULT = '[tool result cleared]';

export interface CompactionOptions {
  maxTokens: number;
  reservedHeadroom?: number;
  keepRecent?: number;
  summarize: (transcript: string, context: { messages: number }) => Promise<string>;
}

export interface CompactionResult {
  compacted: boolean;
  messages: SessionMessage[];
  tokensBefore: number;
  tokensAfter: number;
}

export function estimateMessageTokens(message: SessionMessage): number {
  let total = estimateTokens(message.content) + 4;
  if (message.toolCalls) total += estimateTokens(JSON.stringify(message.toolCalls));
  if (message.toolResults) total += estimateTokens(JSON.stringify(message.toolResults));
  return total;
}

export function estimateMessagesTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export async function compactMessages(
  messages: SessionMessage[],
  options: CompactionOptions
): Promise<CompactionResult> {
  const tokensBefore = estimateMessagesTokens(messages);
  const keepRecent = options.keepRecent ?? 6;
  const headroom = options.reservedHeadroom ?? Math.min(2000, Math.round(options.maxTokens * 0.1));
  const noop: CompactionResult = {
    compacted: false,
    messages,
    tokensBefore,
    tokensAfter: tokensBefore,
  };
  if (tokensBefore <= options.maxTokens - headroom) return noop;
  const cut = messages.length - keepRecent;
  if (cut <= 0) return noop;

  let lastSummary = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === 'system' && message.content.startsWith(SUMMARY_MARKER)) lastSummary = i;
  }
  const spanStart = lastSummary + 1;
  if (spanStart >= cut) return noop;

  const span = messages.slice(spanStart, cut);
  const transcript = span
    .map((message) =>
      message.role === 'tool'
        ? `tool: ${CLEARED_TOOL_RESULT}`
        : `${message.role}: ${message.content}`
    )
    .join('\n');
  const summarized = await options.summarize(transcript, { messages: span.length });
  const summaryLimit = headroom * 4;
  const summary =
    summarized.length > summaryLimit ? `${summarized.slice(0, summaryLimit)}…` : summarized;
  const summaryMessage: SessionMessage = {
    role: 'system',
    content: `${SUMMARY_MARKER}\n${summary}`,
    timestamp: new Date(),
  };
  const next = [...messages.slice(0, spanStart), summaryMessage, ...messages.slice(cut)];
  return {
    compacted: true,
    messages: next,
    tokensBefore,
    tokensAfter: estimateMessagesTokens(next),
  };
}

export interface ProviderCompactionResult {
  compacted: boolean;
  messages: ProviderMessage[];
  tokensBefore: number;
  tokensAfter: number;
}

export function estimateProviderMessagesTokens(messages: ProviderMessage[]): number {
  return messages.reduce((sum, message) => {
    let total = estimateTokens(message.content) + 4;
    if (message.toolCalls) total += estimateTokens(JSON.stringify(message.toolCalls));
    return sum + total;
  }, 0);
}

export async function compactProviderMessages(
  messages: ProviderMessage[],
  options: Omit<CompactionOptions, 'keepRecent'> & { keepRecent?: number }
): Promise<ProviderCompactionResult> {
  const tokensBefore = estimateProviderMessagesTokens(messages);
  const keepRecent = options.keepRecent ?? 6;
  const headroom = options.reservedHeadroom ?? Math.min(2000, Math.round(options.maxTokens * 0.1));
  const noop: ProviderCompactionResult = {
    compacted: false,
    messages,
    tokensBefore,
    tokensAfter: tokensBefore,
  };
  if (tokensBefore <= options.maxTokens - headroom) return noop;

  const cut = messages.length - keepRecent;
  if (cut <= 1) return noop;

  let lastSummary = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === 'system' && message.content.startsWith(SUMMARY_MARKER)) {
      lastSummary = i;
    }
  }
  const spanStart = Math.max(1, lastSummary + 1);
  if (spanStart >= cut) return noop;

  const span = messages.slice(spanStart, cut);
  const transcript = span
    .map((message) =>
      message.role === 'tool'
        ? `tool: ${CLEARED_TOOL_RESULT}`
        : `${message.role}: ${message.content}`
    )
    .join('\n');
  const summarized = await options.summarize(transcript, { messages: span.length });
  const summaryLimit = headroom * 4;
  const summary =
    summarized.length > summaryLimit ? `${summarized.slice(0, summaryLimit)}…` : summarized;
  const next: ProviderMessage[] = [
    ...messages.slice(0, spanStart),
    { role: 'system', content: `${SUMMARY_MARKER}\n${summary}` },
    ...messages.slice(cut),
  ];
  return {
    compacted: true,
    messages: next,
    tokensBefore,
    tokensAfter: estimateProviderMessagesTokens(next),
  };
}
