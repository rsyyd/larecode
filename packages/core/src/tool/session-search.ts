import { LareError } from '../error/error.js';
import { renderHistoryDigest, searchSessions, type SessionSearchHit } from '../session/search.js';
import type { Tool } from './tool.js';

interface SessionSearchArgs {
  query?: string;
  limit?: number;
}

function formatHit(hit: SessionSearchHit): Record<string, unknown> {
  return {
    sessionId: hit.sessionId,
    updatedAt: hit.updatedAt.toISOString(),
    matches: hit.matches,
    snippet: hit.snippet,
  };
}

export function sessionSearchTool(): Tool {
  return {
    name: 'session_search',
    description:
      'Full-text search across past sessions and return matching snippets with a digest. Use it to recall earlier work. Requires the read permission group.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms' },
        limit: { type: 'number', description: 'Maximum sessions to return (default 10)' },
      },
      required: ['query'],
    },
    async execute(args, context) {
      const { query, limit } = (args ?? {}) as SessionSearchArgs;
      if (typeof query !== 'string' || query.trim() === '') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'query is required');
      }
      const decision = context.permissions.check('read', { source: 'session_search' });
      if (!decision.allowed) {
        throw new LareError(
          'PERMISSION_DENIED',
          decision.reason ?? 'session search requires the read permission group'
        );
      }
      const hits = searchSessions(query, { limit });
      return {
        query,
        hits: hits.map(formatHit),
        summary: renderHistoryDigest(hits),
      };
    },
  };
}
