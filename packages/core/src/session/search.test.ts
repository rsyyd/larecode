import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessions, type SessionMessage } from './session.js';
import { renderHistoryDigest, searchHistory, searchSessions } from './search.js';
import { sessionSearchTool } from '../tool/session-search.js';
import { Permissions } from '../permission/permission.js';
import type { ToolContext } from '../tool/tool.js';

let dir: string;
let sessions: Sessions;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumps-search-'));
  sessions = new Sessions(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function seed(role: SessionMessage['role'], content: string): string {
  const session = sessions.create();
  session.messages.push({ role, content, timestamp: new Date() });
  sessions.save(session);
  return session.id;
}

describe('searchSessions', () => {
  it('finds sessions and ranks user matches above repeated assistant mentions', () => {
    const userMatch = seed('user', 'Set up the kubernetes cluster');
    const assistantMatch = seed('assistant', 'kubernetes kubernetes kubernetes');
    seed('assistant', 'unrelated notes');

    const hits = searchSessions('kubernetes', { sessions });
    expect(hits).toHaveLength(2);
    expect(hits[0].sessionId).toBe(userMatch);
    expect(hits[0].score).toBe(2);
    expect(hits[1].sessionId).toBe(assistantMatch);
    expect(hits[1].matches).toBe(3);
  });

  it('returns a snippet around the first match', () => {
    seed('user', `${'filler '.repeat(30)}needle in the haystack ${'tail '.repeat(60)}`);
    const [hit] = searchSessions('needle', { sessions });
    expect(hit.snippet).toContain('needle in the haystack');
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    expect(hit.snippet.length).toBeLessThanOrEqual(400);
  });

  it('ignores tool output and too-short terms', () => {
    seed('tool', 'secret kubernetes output');
    expect(searchSessions('kubernetes', { sessions })).toEqual([]);
    expect(searchSessions('a', { sessions })).toEqual([]);
    expect(searchSessions('   ', { sessions })).toEqual([]);
  });

  it('caps results at the limit', () => {
    for (let i = 0; i < 3; i += 1) seed('user', `alpha run ${i}`);
    expect(searchSessions('alpha', { sessions, limit: 2 })).toHaveLength(2);
  });
});

describe('searchHistory', () => {
  it('falls back to a rendered digest without a summarizer', async () => {
    const id = seed('user', 'deploy the service with docker');
    const { hits, summary } = await searchHistory('docker deploy', { sessions });
    expect(hits).toHaveLength(1);
    expect(summary).toContain(id);
    expect(summary).toContain('docker');
  });

  it('summarizes the digest through the LLM seam', async () => {
    seed('user', 'docker compose deployment notes');
    const summarize = vi.fn(async (digest: string) => {
      expect(digest).toContain('docker compose');
      return 'You deployed with docker compose.';
    });
    const { summary } = await searchHistory('docker', { sessions, summarize });
    expect(summarize).toHaveBeenCalledOnce();
    expect(summary).toBe('You deployed with docker compose.');
  });

  it('returns an empty summary when nothing matches', async () => {
    expect(await searchHistory('ghost', { sessions })).toEqual({ hits: [], summary: '' });
  });
});

describe('renderHistoryDigest', () => {
  it('renders one line per hit with the session id and date', () => {
    const digest = renderHistoryDigest([
      {
        sessionId: 'abc',
        updatedAt: new Date('2026-10-01T12:00:00Z'),
        score: 1,
        matches: 1,
        snippet: 'hello',
      },
    ]);
    expect(digest).toBe('session abc (2026-10-01): hello');
  });
});

function ctx(permissions: Permissions): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: dir,
    permissions,
    abortSignal: new AbortController().signal,
  };
}

describe('session_search tool', () => {
  it('denies without the read permission group', async () => {
    await expect(
      sessionSearchTool().execute(
        { query: 'docker' },
        ctx(new Permissions({ mode: 'ask', allowedGroups: [] }))
      )
    ).rejects.toThrow(/read/);
  });

  it('returns hits and a digest from the session store', async () => {
    const home = await mkdtemp(join(tmpdir(), 'lumps-home-'));
    const previous = process.env.LUMPSCODE_HOME;
    process.env.LUMPSCODE_HOME = home;
    try {
      const store = new Sessions();
      const session = store.create('remember the docker compose setup');
      store.save(session);

      const result = (await sessionSearchTool().execute(
        { query: 'docker compose' },
        ctx(new Permissions())
      )) as { query: string; hits: { sessionId: string }[]; summary: string };
      expect(result.hits[0].sessionId).toBe(session.id);
      expect(result.summary).toContain('docker compose');
    } finally {
      if (previous === undefined) delete process.env.LUMPSCODE_HOME;
      else process.env.LUMPSCODE_HOME = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
});
