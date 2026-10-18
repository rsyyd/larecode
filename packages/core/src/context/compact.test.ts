import { describe, expect, it, vi } from 'vitest';
import { CLEARED_TOOL_RESULT, SUMMARY_MARKER, compactMessages } from './compact.js';
import { estimateMessagesTokens } from './compact.js';
import type { SessionMessage } from '../session/session.js';

function message(role: SessionMessage['role'], content: string): SessionMessage {
  return { role, content, timestamp: new Date(0) };
}

function conversation(turns: number, size = 200): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (let i = 0; i < turns; i += 1) {
    messages.push(message('user', `turn ${i} ${'u'.repeat(size)}`));
    messages.push(message('assistant', `answer ${i} ${'a'.repeat(size)}`));
  }
  return messages;
}

describe('compaction', () => {
  it('does nothing below the trigger threshold', async () => {
    const messages = conversation(2, 20);
    const summarize = vi.fn(async () => 'summary');
    const result = await compactMessages(messages, { maxTokens: 1000, summarize });
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('summarizes the middle span, clears tool results, and keeps recent turns verbatim', async () => {
    const messages = conversation(10, 200);
    messages.splice(8, 0, message('tool', 'SECRET TOOL PAYLOAD'));
    const recent = messages.slice(-4).map((m) => m.content);
    let captured = '';
    const summarize = vi.fn(async (transcript: string) => {
      captured = transcript;
      return 'the summary';
    });
    const result = await compactMessages(messages, {
      maxTokens: 800,
      reservedHeadroom: 200,
      keepRecent: 4,
      summarize,
    });
    expect(result.compacted).toBe(true);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(captured).toContain(CLEARED_TOOL_RESULT);
    expect(captured).not.toContain('SECRET TOOL PAYLOAD');
    expect(result.messages[0].content).toBe(`${SUMMARY_MARKER}\nthe summary`);
    expect(result.messages.slice(1).map((m) => m.content)).toEqual(recent);
    expect(result.tokensAfter).toBeLessThan(estimateMessagesTokens(messages));
  });

  it('never re-summarizes a previous compaction', async () => {
    const messages = conversation(10, 200);
    const first = await compactMessages(messages, {
      maxTokens: 800,
      reservedHeadroom: 200,
      keepRecent: 4,
      summarize: async () => 'SUMMARY-ONE',
    });
    expect(first.compacted).toBe(true);

    const grown = [...first.messages, ...conversation(8, 200)];
    let captured = '';
    const second = await compactMessages(grown, {
      maxTokens: 800,
      reservedHeadroom: 200,
      keepRecent: 4,
      summarize: async (transcript: string) => {
        captured = transcript;
        return 'SUMMARY-TWO';
      },
    });
    expect(second.compacted).toBe(true);
    expect(captured).not.toContain('SUMMARY-ONE');
    expect(second.messages[0].content).toContain('SUMMARY-ONE');
    expect(second.messages[1].content).toContain('SUMMARY-TWO');
    expect(second.messages.filter((m) => m.content.startsWith(SUMMARY_MARKER))).toHaveLength(2);

    const again = await compactMessages(second.messages, {
      maxTokens: 800,
      reservedHeadroom: 200,
      keepRecent: 4,
      summarize: vi.fn(async () => 'nope'),
    });
    expect(again.compacted).toBe(false);
  });

  it('bounds the generated summary by the reserved headroom', async () => {
    const messages = conversation(10, 400);
    const result = await compactMessages(messages, {
      maxTokens: 1000,
      reservedHeadroom: 50,
      keepRecent: 2,
      summarize: async () => 's'.repeat(5000),
    });
    expect(result.compacted).toBe(true);
    const summary = result.messages[0].content;
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MARKER.length + 1 + 200 + 1);
    expect(summary.endsWith('…')).toBe(true);
  });
});
