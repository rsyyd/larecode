export type SpanKind = 'text' | 'heading' | 'code' | 'bold' | 'italic' | 'link';
export type DiffKind = 'add' | 'remove' | 'meta';

export interface MarkdownSpan {
  text: string;
  kind: SpanKind;
}

export interface MarkdownLine {
  spans: MarkdownSpan[];
  code: boolean;
  diff?: DiffKind;
}

// oxlint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function stripTerminal(text: string): string {
  return text.replace(ANSI, '').replace(CONTROL, '');
}

function diffKind(line: string): DiffKind | undefined {
  if (line.startsWith('@@')) return 'meta';
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return undefined;
}

export function looksLikeDiff(text: string): boolean {
  return /^@@ /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text));
}

function inline(text: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  let rest = text;
  let plain = '';

  const pushPlain = (): void => {
    if (plain.length > 0) {
      spans.push({ text: plain, kind: 'text' });
      plain = '';
    }
  };

  while (rest.length > 0) {
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      pushPlain();
      spans.push({ text: code[1], kind: 'code' });
      rest = rest.slice(code[0].length);
      continue;
    }
    const bold = /^\*\*([^*]+)\*\*/.exec(rest);
    if (bold) {
      pushPlain();
      spans.push({ text: bold[1], kind: 'bold' });
      rest = rest.slice(bold[0].length);
      continue;
    }
    const italic = /^\*([^*]+)\*/.exec(rest);
    if (italic) {
      pushPlain();
      spans.push({ text: italic[1], kind: 'italic' });
      rest = rest.slice(italic[0].length);
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (link) {
      pushPlain();
      spans.push({ text: link[1], kind: 'link' });
      rest = rest.slice(link[0].length);
      continue;
    }
    plain += rest[0];
    rest = rest.slice(1);
  }
  pushPlain();
  return spans.length > 0 ? spans : [{ text: '', kind: 'text' }];
}

export function markdownLines(text: string): MarkdownLine[] {
  const lines = stripTerminal(text).split('\n');
  const diff = looksLikeDiff(text);
  let fenced = false;

  return lines.map((raw) => {
    const fence = /^\s*```/.test(raw);
    if (fence) {
      const line: MarkdownLine = { spans: [{ text: raw.trim(), kind: 'code' }], code: true };
      if (diff) line.diff = 'meta';
      fenced = !fenced;
      return line;
    }
    if (fenced) {
      const line: MarkdownLine = { spans: [{ text: raw, kind: 'code' }], code: true };
      if (diff) {
        const kind = diffKind(raw);
        if (kind) line.diff = kind;
      }
      return line;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      return { spans: [{ text: heading[2], kind: 'heading' }], code: false };
    }
    const line: MarkdownLine = { spans: inline(raw), code: false };
    if (diff) {
      const kind = diffKind(raw);
      if (kind) line.diff = kind;
    }
    return line;
  });
}

export function compactToolText(text: string, maxLines = 12): { text: string; hidden: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, hidden: 0 };
  const keep = Math.max(1, maxLines - 1);
  const hidden = lines.length - keep;
  return { text: `${lines.slice(0, keep).join('\n')}\n… ${hidden} more lines`, hidden };
}
