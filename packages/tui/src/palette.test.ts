import { describe, expect, it } from 'vitest';
import { COMMANDS, filterCommands } from './palette.js';
import { appendChunk } from './messages.js';

describe('filterCommands', () => {
  it('returns nothing for plain text', () => {
    expect(filterCommands('hello')).toEqual([]);
    expect(filterCommands('')).toEqual([]);
  });

  it('filters by prefix', () => {
    const matches = filterCommands('/he');
    expect(matches.map((command) => command.name)).toEqual(['/help']);
  });

  it('hides the exact match so enter submits it', () => {
    expect(filterCommands('/help')).toEqual([]);
  });

  it('caps the list', () => {
    expect(filterCommands('/').length).toBeLessThanOrEqual(6);
  });

  it('only lists implemented commands', () => {
    const names = COMMANDS.map((command) => command.name);
    expect(names).toEqual(['/help', '/clear', '/theme', '/model', '/exit']);
  });
});

describe('appendChunk', () => {
  it('appends to the last agent message', () => {
    const messages = appendChunk(
      [
        { role: 'user' as const, text: 'hi' },
        { role: 'agent' as const, text: 'Hel' },
      ],
      'lo'
    );
    expect(messages[1].text).toBe('Hello');
    expect(messages).toHaveLength(2);
  });

  it('starts a new agent message when the last is not agent', () => {
    const messages = appendChunk([{ role: 'user' as const, text: 'hi' }], 'x');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: 'agent', text: 'x' });
  });
});
