import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sessions } from '@larecode/core';
import { finishTurn, sessionMessages, startTurn } from './commands/chat.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-chat-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('sessionMessages', () => {
  it('replays user and assistant turns from a saved session', () => {
    const sessions = new Sessions(dir);
    const stored = sessions.create();
    const now = new Date();
    stored.messages.push(
      { role: 'user', content: 'hello', timestamp: now },
      { role: 'tool', content: 'ignored', timestamp: now },
      { role: 'assistant', content: 'hi there', timestamp: now }
    );
    sessions.save(stored);

    expect(sessionMessages(sessions.get(stored.id)!)).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'agent', text: 'hi there' },
    ]);
  });
});

describe('turn persistence', () => {
  it('keeps the last user message when the process dies mid-turn', () => {
    const sessions = new Sessions(dir);
    const stored = sessions.create();
    startTurn(sessions, stored, 'say hi');

    const restarted = new Sessions(dir).get(stored.id)!;
    expect(restarted.messages.map((message) => message.content)).toEqual(['say hi']);
  });

  it('records the assistant reply and usage after the turn', () => {
    const sessions = new Sessions(dir);
    const stored = sessions.create();
    startTurn(sessions, stored, 'say hi');
    finishTurn(sessions, stored, 'hello', {
      totalTokens: { input: 3, output: 2, total: 5 },
      totalCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      byModel: {},
      conversationId: stored.id,
      startedAt: 0,
      updatedAt: 0,
    });

    const restarted = new Sessions(dir).get(stored.id)!;
    expect(sessionMessages(restarted)).toEqual([
      { role: 'user', text: 'say hi' },
      { role: 'agent', text: 'hello' },
    ]);
    expect(restarted.metadata.tokenUsage).toBe(5);
  });
});
