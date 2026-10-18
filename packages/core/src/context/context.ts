import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { looksBinary, walkFiles } from '../tool/files.js';
import { estimateTokens } from '../usage/usage.js';

export interface ContextQuery {
  query: string;
  maxFiles?: number;
  budgetTokens?: number;
}

export interface RelevanceScore {
  file: string;
  score: number;
  line: number;
  snippet: string;
}

export interface ContextResult {
  files: RelevanceScore[];
  budgetUsed: number;
}

export const CONTEXT_BUDGET_TOKENS = 1200;
export const CONTEXT_MAX_FILES = 8;

const MAX_INDEX_BYTES = 512 * 1024;
const MAX_TERMS_PER_FILE = 3000;
const TERM_RE = /[a-z0-9_]{3,}/g;
const MAX_SNIPPET_CHARS = 200;

interface IndexedFile {
  file: string;
  terms: Map<string, number>;
  pathTerms: Set<string>;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(TERM_RE) ?? [];
}

export class Context {
  private root = '';
  private files: IndexedFile[] = [];
  private docFreq = new Map<string, number>();
  private byTerm = new Map<string, number[]>();
  private snippets = new Map<string, string[]>();

  index(root: string): Promise<number> {
    return this.build(root);
  }

  private async build(root: string): Promise<number> {
    this.root = root;
    this.files = [];
    this.docFreq = new Map();
    this.byTerm = new Map();
    this.snippets = new Map();
    for await (const file of walkFiles(root)) {
      let buf: Buffer;
      try {
        buf = await readFile(join(root, file));
      } catch {
        continue;
      }
      if (looksBinary(buf) || buf.length > MAX_INDEX_BYTES) continue;
      const content = buf.toString('utf8');
      const terms = new Map<string, number>();
      for (const term of tokenize(content)) {
        if (terms.size >= MAX_TERMS_PER_FILE && !terms.has(term)) continue;
        terms.set(term, (terms.get(term) ?? 0) + 1);
      }
      const index = this.files.length;
      this.files.push({ file, terms, pathTerms: new Set(tokenize(file)) });
      this.snippets.set(file, content.split('\n'));
      for (const term of terms.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
        const list = this.byTerm.get(term) ?? [];
        list.push(index);
        this.byTerm.set(term, list);
      }
      for (const term of this.files[index].pathTerms) {
        if (terms.has(term)) continue;
        const list = this.byTerm.get(term) ?? [];
        list.push(index);
        this.byTerm.set(term, list);
      }
    }
    return this.files.length;
  }

  get size(): number {
    return this.files.length;
  }

  search(query: ContextQuery): ContextResult {
    const queryTerms = [...new Set(tokenize(query.query))];
    const budget = query.budgetTokens ?? CONTEXT_BUDGET_TOKENS;
    const maxFiles = query.maxFiles ?? CONTEXT_MAX_FILES;
    if (queryTerms.length === 0 || this.files.length === 0) {
      return { files: [], budgetUsed: 0 };
    }

    const scores = new Map<number, number>();
    const total = this.files.length;
    for (const term of queryTerms) {
      const idf = Math.log(1 + total / (this.docFreq.get(term) ?? 1));
      for (const index of this.byTerm.get(term) ?? []) {
        const file = this.files[index];
        const tf = file.terms.get(term) ?? 0;
        const pathBoost = file.pathTerms.has(term) ? 3 : 0;
        scores.set(index, (scores.get(index) ?? 0) + idf * (tf / (tf + 1.2)) + pathBoost);
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxFiles);

    const files: RelevanceScore[] = [];
    let budgetUsed = 0;
    for (const [index, score] of ranked) {
      const file = this.files[index];
      const { line, snippet } = this.bestSnippet(file.file, queryTerms);
      const cost = estimateTokens(`${file.file}:${line} ${snippet}`) + 1;
      if (files.length > 0 && budgetUsed + cost > budget) break;
      files.push({ file: file.file, score: Number(score.toFixed(4)), line, snippet });
      budgetUsed += cost;
    }
    return { files, budgetUsed };
  }

  private bestSnippet(file: string, queryTerms: string[]): { line: number; snippet: string } {
    const lines = this.snippets.get(file) ?? [];
    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i].toLowerCase();
      if (queryTerms.some((term) => lower.includes(term))) {
        const text = lines[i].trim();
        return {
          line: i + 1,
          snippet: text.length > MAX_SNIPPET_CHARS ? `${text.slice(0, MAX_SNIPPET_CHARS)}…` : text,
        };
      }
    }
    return { line: 1, snippet: '' };
  }
}
