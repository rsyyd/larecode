import { describe, expect, it } from 'vitest';
import { searchMessages } from './search.js';

const messages = [
  { role: 'user' as const, text: 'Where is the retry logic?' },
  { role: 'agent' as const, text: 'The retry lives in runtime.ts.\nIt retries 429 responses.' },
  { role: 'tool' as const, text: 'read · runtime.ts' },
];

describe('conversation search', () => {
  it('finds case-insensitive matches with a single-line preview', () => {
    const hits = searchMessages(messages, 'RETRY');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ index: 0, role: 'user' });
    expect(hits[1]).toMatchObject({ index: 1, role: 'agent' });
    expect(hits[1].preview).not.toContain('\n');
    expect(hits[1].preview).toContain('runtime.ts');
  });

  it('ignores empty queries and terminal escapes', () => {
    expect(searchMessages(messages, '   ')).toEqual([]);
    expect(
      searchMessages([{ role: 'agent', text: '\x1b[31msecret\x1b[0m' }], 'secret')
    ).toHaveLength(1);
  });

  it('returns no hits for an absent query', () => {
    expect(searchMessages(messages, 'nonexistent')).toEqual([]);
  });
});
