import type { Context } from './context.js';

export interface RetrievalCase {
  query: string;
  expected: string;
}

export interface RetrievalCaseResult {
  query: string;
  expected: string;
  found: boolean;
  files: string[];
}

export interface RetrievalReport {
  total: number;
  hits: number;
  recall: number;
  results: RetrievalCaseResult[];
}

export function evaluateRetrieval(
  context: Pick<Context, 'search'>,
  cases: RetrievalCase[],
  topK = 3
): RetrievalReport {
  const results = cases.map((entry) => {
    const files = context
      .search({ query: entry.query, maxFiles: topK })
      .files.map((hit) => hit.file);
    return {
      query: entry.query,
      expected: entry.expected,
      found: files.includes(entry.expected),
      files,
    };
  });
  const hits = results.filter((result) => result.found).length;
  return {
    total: results.length,
    hits,
    recall: results.length === 0 ? 1 : hits / results.length,
    results,
  };
}
