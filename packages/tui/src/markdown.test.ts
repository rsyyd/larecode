import { describe, expect, it } from 'vitest';
import { compactToolText, looksLikeDiff, markdownLines, stripTerminal } from './markdown.js';

describe('markdown rendering', () => {
  it('styles headings, inline code, bold, italic, and links', () => {
    const [heading, body] = markdownLines(
      '# Title\nUse `code`, **bold**, *italic*, and [docs](https://example.com)'
    );
    expect(heading.spans).toEqual([{ text: 'Title', kind: 'heading' }]);
    expect(body.spans).toEqual([
      { text: 'Use ', kind: 'text' },
      { text: 'code', kind: 'code' },
      { text: ', ', kind: 'text' },
      { text: 'bold', kind: 'bold' },
      { text: ', ', kind: 'text' },
      { text: 'italic', kind: 'italic' },
      { text: ', and ', kind: 'text' },
      { text: 'docs', kind: 'link' },
    ]);
  });

  it('keeps malformed markers literal instead of throwing', () => {
    const lines = markdownLines('**unclosed and `code\n```js\nconst x = 1;\n');
    expect(lines[0].spans).toEqual([{ text: '**unclosed and `code', kind: 'text' }]);
    expect(lines[1].code).toBe(true);
    expect(lines[2]).toMatchObject({ code: true, spans: [{ text: 'const x = 1;', kind: 'code' }] });
  });

  it('strips ANSI and control sequences from model output', () => {
    expect(stripTerminal('\x1b[31mred\x1b[0m\x1b]8;;https://evil\x07link\x1b]8;;\x07')).toBe(
      'redlink'
    );
    const lines = markdownLines('\x1b[2Jhello\x07');
    expect(lines[0].spans).toEqual([{ text: 'hello', kind: 'text' }]);
  });

  it('marks unified diff lines and leaves prose alone', () => {
    const diff = ['--- a/file.ts', '+++ b/file.ts', '@@ -1 +1 @@', '-old', '+new'].join('\n');
    expect(looksLikeDiff(diff)).toBe(true);
    expect(markdownLines(diff)).toMatchSnapshot();
    expect(markdownLines(diff).map((line) => line.diff)).toEqual([
      'meta',
      'meta',
      'meta',
      'remove',
      'add',
    ]);
    expect(looksLikeDiff('- a bullet\n+ not a diff')).toBe(false);
  });

  it('compacts long tool output and reports how much is hidden', () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n');
    const compact = compactToolText(text, 10);
    expect(compact.hidden).toBe(11);
    expect(compact.text.split('\n')).toHaveLength(10);
    expect(compact.text).toContain('… 11 more lines');
    expect(compactToolText('short', 10)).toEqual({ text: 'short', hidden: 0 });
  });
});
