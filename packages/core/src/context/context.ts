import { looksBinary, readFilesConcurrent, walkFiles } from '../tool/files.js';
import { estimateTokens } from '../usage/usage.js';
import { createEmbeddingService, cosineSimilarity, type EmbeddingService } from './embeddings.js';

export interface ContextQuery {
  query: string;
  maxFiles?: number;
  budgetTokens?: number;
  useSemantic?: boolean;
  semanticWeight?: number;
}

export interface RelevanceScore {
  file: string;
  score: number;
  line: number;
  snippet: string;
  lexicalScore?: number;
  semanticScore?: number;
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
  embedding?: number[];
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
  private embeddingService: EmbeddingService | null = null;
  private useSemanticDefault = false;
  private semanticWeightDefault = 0.5;

  index(root: string): Promise<number> {
    return this.build(root);
  }

  setEmbeddingService(service: EmbeddingService): void {
    this.embeddingService = service;
  }

  setSemanticDefaults(enabled: boolean, weight: number = 0.5): void {
    this.useSemanticDefault = enabled;
    this.semanticWeightDefault = weight;
  }

  private async build(root: string): Promise<number> {
    this.root = root;
    this.files = [];
    this.docFreq = new Map();
    this.byTerm = new Map();
    this.snippets = new Map();
    const paths: string[] = [];
    for await (const file of walkFiles(root)) paths.push(file);
    const loaded = await readFilesConcurrent(root, paths, { maxBytes: MAX_INDEX_BYTES });

    // First pass: build lexical index
    for (const { file, buf } of loaded) {
      if (looksBinary(buf)) continue;
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

    // Second pass: compute embeddings if semantic search is enabled
    if (this.embeddingService && this.useSemanticDefault) {
      await this.computeEmbeddings();
    }

    return this.files.length;
  }

  private async computeEmbeddings(): Promise<void> {
    if (!this.embeddingService) return;

    const texts = this.files.map((f) => {
      const snippet = this.snippets.get(f.file);
      return f.file + '\n' + (snippet ? snippet.join('\n') : '');
    });

    try {
      const embeddings = await this.embeddingService.embed(texts);
      for (let i = 0; i < this.files.length; i++) {
        this.files[i].embedding = embeddings[i];
      }
    } catch (error) {
      console.warn('Failed to compute embeddings:', error);
    }
  }

  get size(): number {
    return this.files.length;
  }

  async search(query: ContextQuery): Promise<ContextResult> {
    const useSemantic = query.useSemantic ?? this.useSemanticDefault;
    const semanticWeight = query.semanticWeight ?? this.semanticWeightDefault;
    const lexicalWeight = 1 - semanticWeight;

    const queryTerms = [...new Set(tokenize(query.query))];
    const budget = query.budgetTokens ?? CONTEXT_BUDGET_TOKENS;
    const maxFiles = query.maxFiles ?? CONTEXT_MAX_FILES;

    if (queryTerms.length === 0 && this.files.length === 0) {
      return { files: [], budgetUsed: 0 };
    }

    // Lexical search (BM25-style)
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

    // Semantic search
    let semanticScores = new Map<number, number>();
    if (useSemantic && this.embeddingService) {
      try {
        const queryEmbedding = await this.embeddingService.embedQuery(query.query);

        for (let i = 0; i < this.files.length; i++) {
          const file = this.files[i];
          if (file.embedding) {
            const similarity = cosineSimilarity(queryEmbedding, file.embedding);
            semanticScores.set(i, similarity);
          }
        }
      } catch (error) {
        console.warn('Semantic search failed:', error);
      }
    }

    // Combine scores
    const combinedScores = new Map<number, number>();
    for (const [index, lexicalScore] of scores) {
      const semanticScore = semanticScores.get(index) ?? 0;
      combinedScores.set(index, lexicalScore * (1 - 0.5) + semanticScore * 0.5);
    }

    // If no lexical matches but semantic available
    for (const [index, semanticScore] of semanticScores) {
      if (!scores.has(index)) {
        combinedScores.set(index, semanticScore * 0.5);
      }
    }

    const ranked = [...combinedScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxFiles);

    const files: RelevanceScore[] = [];
    let budgetUsed = 0;

    for (const [index, score] of ranked) {
      const file = this.files[index];
      const { line, snippet } = this.bestSnippet(file.file, queryTerms);
      const cost = estimateTokens(`${file.file}:${line} ${snippet}`) + 1;

      if (files.length > 0 && budgetUsed + cost > budget) break;

      const lexicalScore = queryTerms.length > 0 ? (scores.get(index) ?? 0) : 0;
      const semanticScore = useSemantic ? (semanticScores.get(index) ?? 0) : 0;

      files.push({
        file: file.file,
        score: Number(score.toFixed(4)),
        line,
        snippet,
        lexicalScore: Number(lexicalScore.toFixed(4)),
        semanticScore: Number(semanticScore.toFixed(4)),
      });
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
