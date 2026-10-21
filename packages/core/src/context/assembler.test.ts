import { describe, expect, it } from 'vitest';
import { CONTEXT_ALLOCATION, assembleContext } from './assembler.js';

describe('assembleContext', () => {
  it('keeps the output reserve and stays within the budget', () => {
    const result = assembleContext(
      [
        { name: 'system', content: 'You are larecode.' },
        { name: 'instructions', content: 'Follow the repository rules.' },
        { name: 'retrieval', content: 'const widget = 1;' },
        { name: 'memory', content: 'The project uses bun.' },
        { name: 'history', content: 'user: hi\nassistant: hello' },
      ],
      1000
    );

    expect(result.reserved).toBe(Math.floor(1000 * CONTEXT_ALLOCATION.output));
    expect(result.used + result.reserved).toBeLessThanOrEqual(1000);
    expect(result.text).toContain('You are larecode.');
    expect(result.text).toContain('The project uses bun.');
    expect(result.sections.map((section) => section.name)).toEqual([
      'system',
      'instructions',
      'retrieval',
      'memory',
      'history',
      'output',
    ]);
  });

  it('truncates a section that exceeds its share and rolls unused budget forward', () => {
    const result = assembleContext(
      [
        { name: 'system', content: 'tiny' },
        { name: 'retrieval', content: 'x'.repeat(20_000) },
      ],
      1000
    );

    expect(result.text).toContain('tiny');
    expect(result.text).toContain('…');
    expect(result.used).toBeLessThanOrEqual(result.total - result.reserved);
    const retrieval = result.sections.find((section) => section.name === 'retrieval');
    expect(retrieval?.truncated).toBe(true);
  });

  it('drops empty sections from the rendered text', () => {
    const result = assembleContext(
      [
        { name: 'system', content: 'system prompt' },
        { name: 'memory', content: '   ' },
      ],
      200
    );

    expect(result.text).toBe('system prompt');
    expect(result.sections.some((section) => section.name === 'memory')).toBe(false);
  });
});
