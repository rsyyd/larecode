import { Sessions } from './session.js';

export const SESSION_SEARCH_LIMIT = 10;
export const SESSION_SEARCH_MAX_LIMIT = 50;
export const SESSION_SEARCH_SNIPPET_CHARS = 200;
export const HISTORY_DIGEST_MAX_CHARS = 12_000;

const SEARCH_TERM_RE = /[a-z0-9_]{2,}/g;

export interface SessionSearchHit {
  sessionId: string;
  updatedAt: Date;
  score: number;
  matches: number;
  snippet: string;
}

export interface SessionSearchOptions {
  sessions?: Sessions;
  limit?: number;
}

export interface SearchHistoryOptions extends SessionSearchOptions {
  summarize?: (digest: string) => Promise<string>;
}

export interface HistorySummary {
  hits: SessionSearchHit[];
  summary: string;
}

function termsOf(query: string): string[] {
  return [...new Set(query.toLowerCase().match(SEARCH_TERM_RE) ?? [])];
}

function snippetAround(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + length + SESSION_SEARCH_SNIPPET_CHARS);
  const text = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`;
}

export function searchSessions(
  query: string,
  options: SessionSearchOptions = {}
): SessionSearchHit[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  // ponytail: scans session JSON files per query; add a token index (or SQLite
  // FTS) when the session store outgrows a lazy scan.
  const sessions = options.sessions ?? new Sessions();
  const hits: SessionSearchHit[] = [];
  for (const metadata of sessions.list()) {
    const session = sessions.get(metadata.id);
    if (!session) continue;
    let score = 0;
    let matches = 0;
    let snippet = '';
    for (const message of session.messages) {
      if (message.role === 'tool') continue;
      const text = message.content.toLowerCase();
      let messageHits = 0;
      for (const term of terms) {
        let index = text.indexOf(term);
        if (index !== -1 && snippet === '') {
          snippet = snippetAround(message.content, index, term.length);
        }
        if (text.includes(term)) score += message.role === 'user' ? 2 : 1;
        while (index !== -1) {
          messageHits += 1;
          index = text.indexOf(term, index + term.length);
        }
      }
      matches += messageHits;
    }
    if (score === 0) continue;
    hits.push({ sessionId: metadata.id, updatedAt: metadata.updatedAt, score, matches, snippet });
  }
  hits.sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime());
  const limit = Math.min(options.limit ?? SESSION_SEARCH_LIMIT, SESSION_SEARCH_MAX_LIMIT);
  return hits.slice(0, limit);
}

export function renderHistoryDigest(hits: SessionSearchHit[]): string {
  return hits
    .map(
      (hit) =>
        `session ${hit.sessionId} (${hit.updatedAt.toISOString().slice(0, 10)}): ${hit.snippet}`
    )
    .join('\n');
}

export async function searchHistory(
  query: string,
  options: SearchHistoryOptions = {}
): Promise<HistorySummary> {
  const hits = searchSessions(query, options);
  if (hits.length === 0) return { hits, summary: '' };
  const digest = renderHistoryDigest(hits).slice(0, HISTORY_DIGEST_MAX_CHARS);
  if (!options.summarize) return { hits, summary: digest };
  const summary = (await options.summarize(digest)).trim();
  return { hits, summary: summary === '' ? digest : summary };
}
