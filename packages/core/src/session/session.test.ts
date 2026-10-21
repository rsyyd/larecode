import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sessions, renderSessionContext } from './session.js';
import { LareError } from '../error/error.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'larecode-sessions-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Sessions persistence', () => {
  it('persists a session on create and reloads it from a fresh instance', () => {
    const sessions = new Sessions(dir);
    const created = sessions.create('hello there');
    created.messages.push({
      role: 'assistant',
      content: 'hi, how can I help',
      timestamp: new Date('2026-10-18T10:00:00Z'),
    });
    sessions.save(created);

    const resumed = new Sessions(dir).get(created.id);
    expect(resumed).toBeDefined();
    expect(resumed!.id).toBe(created.id);
    expect(resumed!.messages).toHaveLength(2);
    expect(resumed!.messages[1].content).toBe('hi, how can I help');
    expect(resumed!.messages[1].timestamp).toEqual(new Date('2026-10-18T10:00:00Z'));
    expect(resumed!.metadata.createdAt).toBeInstanceOf(Date);
    expect(resumed!.metadata.messageCount).toBe(2);
  });

  it('reproduces the context after resume', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('fix the failing test');
    session.messages.push(
      {
        role: 'assistant',
        content: 'running the suite',
        toolCalls: [{ id: 'call-1', name: 'bash', arguments: { command: 'npm test' } }],
        timestamp: new Date(),
      },
      {
        role: 'tool',
        content: '3 tests failed',
        toolResults: [{ id: 'call-1', success: true, output: '3 tests failed' }],
        timestamp: new Date(),
      }
    );
    sessions.save(session);
    const before = renderSessionContext(session);

    const fresh = new Sessions(dir);
    const resumed = fresh.get(session.id)!;
    expect(renderSessionContext(resumed)).toBe(before);
    expect(resumed.messages[2].toolResults?.[0]).toEqual({
      id: 'call-1',
      success: true,
      output: '3 tests failed',
    });
  });

  it('redacts secrets on disk while keeping them in memory', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('deploy with export API_KEY=sk-ant-abcdef1234567890 now');
    session.messages.push({
      role: 'assistant',
      content: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456 accepted',
      timestamp: new Date(),
    });
    sessions.save(session);

    const raw = readFileSync(join(dir, `${session.id}.json`), 'utf8');
    expect(raw).not.toContain('sk-ant-abcdef1234567890');
    expect(raw).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(raw).toContain('[REDACTED]');
    expect(session.messages[0].content).toContain('sk-ant-abcdef1234567890');

    const resumed = new Sessions(dir).get(session.id)!;
    expect(resumed.messages[0].content).not.toContain('sk-ant-abcdef1234567890');
  });

  it('writes files with owner-only permissions', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('x');
    const mode = statSync(join(dir, `${session.id}.json`)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('lists session metadata newest first and skips corrupt files', async () => {
    const sessions = new Sessions(dir);
    const first = sessions.create('one');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = sessions.create('two');
    writeFileSync(join(dir, 'broken.json'), '{not json');

    const listed = new Sessions(dir).list();
    expect(listed.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(listed.every((entry) => entry.updatedAt instanceof Date)).toBe(true);
  });

  it('throws SESSION_CORRUPTED for a corrupt session file', () => {
    writeFileSync(join(dir, 'bad.json'), 'oops');
    const sessions = new Sessions(dir);
    try {
      sessions.get('bad');
      expect.unreachable('expected get to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LareError);
      expect((error as LareError).code).toBe('SESSION_CORRUPTED');
    }
  });

  it('deletes from disk and memory and rejects path-unsafe ids', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('gone soon');
    expect(sessions.delete(session.id)).toBe(true);
    expect(new Sessions(dir).get(session.id)).toBeUndefined();
    expect(sessions.get('../../etc/passwd')).toBeUndefined();
    expect(sessions.delete('../../etc/passwd')).toBe(false);
  });

  it('migrates legacy session files without metadata', () => {
    writeFileSync(
      join(dir, 'legacy-1.json'),
      JSON.stringify({
        id: 'legacy-1',
        messages: [{ role: 'user', content: 'hi', timestamp: '2020-01-01T00:00:00.000Z' }],
      })
    );
    const session = new Sessions(dir).get('legacy-1')!;
    expect(session.metadata.messageCount).toBe(1);
    expect(session.metadata.tokenUsage).toBe(0);
    expect(session.metadata.cost).toBe(0);
    expect(session.metadata.updatedAt).toBeInstanceOf(Date);
  });

  it('rewinds, exports redacted content, and prunes by count', async () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('secret sk-ant-abcdef1234567890');
    session.messages.push(
      { role: 'assistant', content: 'first', timestamp: new Date() },
      { role: 'user', content: 'second', timestamp: new Date() }
    );
    sessions.save(session);

    const markdown = sessions.export(session.id, 'markdown')!;
    expect(markdown).toContain('## user');
    expect(markdown).not.toContain('sk-ant-abcdef1234567890');

    sessions.rewind(session.id, 1);
    expect(new Sessions(dir).get(session.id)!.messages).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = sessions.create('two');
    sessions.prune({ maxSessions: 1 });
    expect(new Sessions(dir).list().map((entry) => entry.id)).toEqual([second.id]);
  });

  it('leaves no temporary files after saving', () => {
    const sessions = new Sessions(dir);
    sessions.create('one');
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('acquires a lock per session file and times out on a fresh lock', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('one');
    writeFileSync(join(dir, `${session.id}.json.lock`), '');
    expect(() => {
      session.messages.push({
        role: 'assistant',
        content: 'blocked',
        timestamp: new Date(),
      });
      sessions.save(session);
    }).toThrow(/locked by another process/);
  });

  it('recovers from a stale lock and serializes parallel writes', async () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('one');
    const lock = join(dir, `${session.id}.json.lock`);
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);

    sessions.save(session);
    expect(existsSync(lock)).toBe(false);
    expect(new Sessions(dir).get(session.id)?.metadata.messageCount).toBe(1);

    const first = sessions.create('a');
    const second = sessions.create('b');
    await Promise.all([
      Promise.resolve().then(() => sessions.save(first)),
      Promise.resolve().then(() => sessions.save(second)),
    ]);
    const reloaded = new Sessions(dir);
    expect(reloaded.get(first.id)?.messages).toHaveLength(1);
    expect(reloaded.get(second.id)?.messages).toHaveLength(1);
  });
});
